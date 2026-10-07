// api/hire-complete.js
// Garantiza que cada hire confirmado tenga su línea en Finanzas, sin pasos
// manuales. Lo llama el modal "¡Hire confirmado!" del ATS:
//   - al confirmar: completa la línea con el start date y el salario del cierre
//     y deja anotado quién confirmó el hire;
//   - al omitir/cerrar el modal: no manda datos, pero igual se asegura de que la
//     línea exista (por_facturar) para que Silvana sepa que hay que facturar.
// Si la línea ya existe (la crea un trigger en la base cuando la postulación
// pasa a "hired"), solo se completan los campos del cierre y solo mientras siga
// por_facturar: lo ya facturado o cobrado no se toca. Los recruiters no pueden
// editar Finanzas en general; esta es la única puerta acotada que tienen.
//
//   POST { application_id, start_date?, salario_bruto? }

const { requireRole } = require('./_auth');
const { cambios } = require('./_finanzas');
const { claveServicio, cabecerasServicio } = require('./_supabase');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALARIO = /^(USD|ARS) [0-9][0-9.,]{0,14}$/;
const TIPOS_OK = new Set(['nueva', 'garantia']);

function fechaValida(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const f = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && y <= 2100 && f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner', 'recruiter']);
  if (!session) return;

  const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY = claveServicio();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });

  const { application_id: appId, start_date: startDate, salario_bruto: salario } = req.body || {};
  if (typeof appId !== 'string' || !UUID.test(appId)) return res.status(400).json({ error: 'Postulación inválida' });
  if (startDate !== undefined && startDate !== null && startDate !== '' && !fechaValida(startDate)) return res.status(400).json({ error: 'Start date inválido' });
  if (salario !== undefined && salario !== null && salario !== '' && !SALARIO.test(String(salario))) return res.status(400).json({ error: 'Salario inválido' });

  const h = { ...cabecerasServicio() };
  const leer = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: h });
    if (!r.ok) throw new Error('lectura falló: ' + r.status);
    return r.json();
  };
  const escribir = (path, method, body, prefer) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...h, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' }, body: JSON.stringify(body),
  });

  try {
    const [app] = await leer(`applications?id=eq.${appId}&select=id,status,recruiter_id,position_id,candidate_id,start_date`);
    if (!app) return res.status(404).json({ error: 'Postulación inexistente' });
    if (app.status !== 'hired') return res.status(409).json({ error: 'La postulación no está en hired' });

    // Quién puede: el owner, el recruiter asignado a la postulación o a la
    // posición, o quien confirmó el hire.
    if (session.role !== 'owner' && app.recruiter_id !== session.id) {
      const [asignado, confirmo] = await Promise.all([
        leer(`position_recruiters?position_id=eq.${app.position_id}&recruiter_id=eq.${session.id}&select=recruiter_id&limit=1`),
        leer(`status_history?application_id=eq.${appId}&new_status=eq.hired&changed_by=eq.${session.id}&select=changed_by&limit=1`),
      ]);
      if (!asignado.length && !confirmo.length) return res.status(403).json({ error: 'No tenés permiso sobre este hire' });
    }

    const [quien] = await leer(`users_public?id=eq.${session.id}&select=name`);
    const nombre = (quien && quien.name) || '';
    const datos = {};
    if (startDate) datos.start_date = startDate;
    if (salario) datos.salario_bruto = String(salario);
    if (nombre) datos.recruiter_name = nombre;

    const [linea] = await leer(`billing?application_id=eq.${appId}&select=*`);
    if (!linea) {
      // Sin línea todavía: se crea con lo que dice la base de este hire.
      const [info] = await leer(`applications?id=eq.${appId}&select=id,candidates(name),positions(role,tipo,clients(name)),users(name)`);
      const pos = (info && info.positions) || {};
      const fila = {
        application_id: appId,
        candidate_name: (info && info.candidates && info.candidates.name) || '',
        client_name: (pos.clients && pos.clients.name) || '',
        position_role: pos.role || '',
        recruiter_name: nombre || (info && info.users && info.users.name) || '',
        start_date: startDate || app.start_date || null,
        salario_bruto: salario || null,
        tipo_busqueda: TIPOS_OK.has(pos.tipo) ? pos.tipo : 'nueva',
        estado: 'por_facturar',
      };
      const r = await escribir('billing', 'POST', [fila]);
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        // Carrera con el trigger: otra línea ya apareció; se completa abajo.
        if (e.code !== '23505') return res.status(502).json({ error: 'No se pudo crear la línea en Finanzas' });
      } else {
        const [nueva] = await r.json();
        await escribir('finanzas_log', 'POST', [{ user_id: session.id, user_name: session.email, tabla: 'billing', row_id: String(nueva.id), accion: 'crear', antes: null, despues: nueva }], 'return=minimal');
        return res.status(200).json({ ok: true, creada: true, actualizada: false });
      }
    }

    const actual = linea || (await leer(`billing?application_id=eq.${appId}&select=*`))[0];
    if (!actual) return res.status(502).json({ error: 'No se pudo leer la línea en Finanzas' });
    if (actual.estado !== 'por_facturar') return res.status(200).json({ ok: true, creada: false, actualizada: false, motivo: 'La línea ya está en ' + actual.estado });

    const { antes, despues } = cambios(actual, datos);
    if (!Object.keys(despues).length) return res.status(200).json({ ok: true, creada: false, actualizada: false });
    const r = await escribir(`billing?id=eq.${actual.id}`, 'PATCH', datos);
    if (!r.ok) return res.status(502).json({ error: 'No se pudo completar la línea en Finanzas' });
    await escribir('finanzas_log', 'POST', [{ user_id: session.id, user_name: session.email, tabla: 'billing', row_id: String(actual.id), accion: 'editar', antes, despues }], 'return=minimal');
    return res.status(200).json({ ok: true, creada: false, actualizada: true });
  } catch (e) {
    console.error('hire-complete error:', e);
    return res.status(502).json({ error: 'No se pudo registrar el hire en Finanzas' });
  }
};
module.exports.fechaValida = fechaValida;
