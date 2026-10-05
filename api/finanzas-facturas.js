// api/finanzas-facturas.js
// Emitir, anular y cobrar facturas de Finanzas. Es la ÚNICA vía para crear una
// factura o moverla de estado: la numeración correlativa (HWG-000001…), las
// validaciones y la auditoría viven en funciones atómicas de Postgres
// (migrations/2026-10-05b_finanzas_facturacion_auditable.sql). Acá solo se
// valida la forma del pedido y se pasa el usuario de la sesión como actor —
// nunca uno que mande el cliente.
//
// Solo owner (Finanzas ya es exclusiva del owner, ver owner-data.js) y, como
// en owner-data.js, con el token del PIN de Finanzas cuando está activo. Las
// tres operaciones quedan en finanzas_log (lo escriben las funciones de la
// base, con el mail de quien las hizo).

const { requireRole, hasFinanzasToken } = require('./_auth');
const { ENFORCE_PIN } = require('./_finanzas');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINEAS = 200;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const optNum = (v) => (v === undefined || v === null || v === '' ? undefined : v);

// Deja pasar solo los campos conocidos de cada línea, ya validados.
function limpiarLineas(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: 'La factura no tiene líneas.' };
  if (lineas.length > MAX_LINEAS) return { error: `Máximo ${MAX_LINEAS} líneas por factura.` };
  const out = [];
  for (const l of lineas) {
    if (!l || typeof l !== 'object') return { error: 'Línea inválida.' };
    if (!isNum(l.monto) || l.monto <= 0) return { error: 'Cada línea necesita un monto mayor a cero.' };
    if (l.billing_id !== undefined && l.billing_id !== null && !isUuid(l.billing_id)) return { error: 'billing_id inválido.' };
    const linea = { monto: l.monto, descripcion: String(l.descripcion ?? '').slice(0, 300) };
    if (l.billing_id) linea.billing_id = l.billing_id;
    for (const k of ['fee_recruiter_monto', 'fee_jose', 'fee_sil', 'tc_dia']) {
      const v = optNum(l[k]);
      if (v === undefined) continue;
      if (!isNum(v) || v < 0) return { error: `${k} inválido.` };
      linea[k] = v;
    }
    out.push(linea);
  }
  return { lineas: out };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Finanzas-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner']);
  if (!session) return;
  if (!isUuid(session.id)) return res.status(401).json({ error: 'Sesión sin usuario válido, volvé a entrar.' });
  // Mismo PIN de Finanzas que exige owner-data.js para las tablas de plata.
  if (ENFORCE_PIN && !hasFinanzasToken(req, session)) {
    return res.status(403).json({ error: 'PIN de Finanzas requerido', code: 'finanzas_pin' });
  }

  const { accion } = req.body || {};
  const b = req.body || {};
  let fn, args;

  if (accion === 'emitir') {
    if (!isUuid(b.cliente_id)) return res.status(400).json({ error: 'Falta el cliente.' });
    if (!['contingency', 'embedded'].includes(b.tipo)) return res.status(400).json({ error: 'Tipo de factura inválido.' });
    if (!['USD', 'ARS'].includes(b.moneda)) return res.status(400).json({ error: 'Moneda inválida (USD o ARS).' });
    if (!isDate(b.fecha)) return res.status(400).json({ error: 'Fecha de factura inválida.' });
    if (b.entidad_id != null && !isUuid(b.entidad_id)) return res.status(400).json({ error: 'Entidad facturadora inválida.' });
    if (b.mes != null && !(typeof b.mes === 'string' && DATE_RE.test(b.mes))) return res.status(400).json({ error: 'Período inválido.' });
    const { lineas, error } = limpiarLineas(b.lineas);
    if (error) return res.status(400).json({ error });
    fn = 'emitir_factura';
    args = {
      p_client_id: b.cliente_id, p_tipo: b.tipo, p_moneda: b.moneda, p_fecha: b.fecha,
      p_actor: session.id, p_entidad_id: b.entidad_id ?? null, p_mes: b.mes ?? null,
      p_nota: b.nota == null ? null : String(b.nota).slice(0, 1000), p_lineas: lineas,
    };
  } else if (accion === 'anular') {
    if (!isUuid(b.factura_id)) return res.status(400).json({ error: 'Falta la factura.' });
    const motivo = String(b.motivo ?? '').trim();
    if (!motivo) return res.status(400).json({ error: 'Anular una factura requiere un motivo.' });
    fn = 'anular_factura';
    args = { p_factura_id: b.factura_id, p_motivo: motivo.slice(0, 500), p_actor: session.id };
  } else if (accion === 'cobrar') {
    if (!isUuid(b.factura_id)) return res.status(400).json({ error: 'Falta la factura.' });
    if (!isDate(b.fecha_cobro)) return res.status(400).json({ error: 'Fecha de cobro inválida.' });
    fn = 'registrar_cobro_factura';
    args = { p_factura_id: b.factura_id, p_fecha_cobro: b.fecha_cobro, p_actor: session.id };
  } else {
    return res.status(400).json({ error: 'Acción inválida (emitir, anular o cobrar).' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      // P0001 = raise exception de las funciones: son reglas de negocio con
      // mensaje pensado para mostrarse (ya facturado, cobrada, etc.).
      if (data && data.code === 'P0001') return res.status(409).json({ error: data.message });
      console.error('finanzas-facturas rpc error:', fn, data);
      return res.status(500).json({ error: 'No se pudo completar la operación.' });
    }
    return res.status(200).json({ ok: true, factura: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    console.error('finanzas-facturas error:', e);
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
};
