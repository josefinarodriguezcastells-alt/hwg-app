// api/owner-data.js
// Proxy genérico y protegido hacia Supabase para las tablas que hoy se leen
// y escriben directo desde el browser con la clave anónima: billing, facturas,
// embedded_nomina_personas, embedded_nomina, entidades_facturadoras, users,
// más (2026-09-22, hallazgo de seguridad de Supabase) candidate_presentations,
// outreach_sequences, outreach_sequence_steps, word_download_log — estas 4
// últimas ya tenían RLS deshabilitado y quedaban 100% públicas con solo la
// clave anónima (visible en el bundle del frontend): cualquiera podía leer,
// editar o borrar informes de candidatos y secuencias de outreach de
// cualquier cliente, sin pasar por el login de la app.
//
// Requiere un JWT válido (ver _auth.js) — 'owner' para las primeras 6 tablas
// (con la excepción puntual de billing+POST), 'owner' o 'recruiter' para las
// últimas 4 (son de uso rutinario de cualquier recruiter, no solo del owner).
// Usa la service key de Supabase server-side, que ignora RLS siempre — la
// clave anónima ya no necesita (ni debería tener) acceso directo a estas
// tablas una vez que se aplique el RLS lockdown (ver migrations/).
//
// El querystring que manda el cliente (select/order/limit/filtros eq/not, etc.)
// se reenvía tal cual a PostgREST — es exactamente lo que supabase-js arma
// internamente, así que el shim del frontend (secureTable en lib/supabase.js)
// puede mantener la misma sintaxis de encadenado que ya se usaba.

const bcrypt = require('bcryptjs');
const { requireRole, hasFinanzasToken } = require('./_auth');
const { FINANZAS_TABLES, LOGGED_TABLES, ENFORCE_PIN, filasLogPatch } = require('./_finanzas');

const ALLOWED_TABLES = new Set([
  'billing',
  'facturas',
  'embedded_nomina_personas',
  'embedded_nomina',
  'entidades_facturadoras',
  'users',
  'candidate_presentations',
  'outreach_sequences',
  'outreach_sequence_steps',
  'word_download_log',
  'client_secrets', // PIN de los portales de clientes (Fase 1b) — solo owner
  'client_stakeholders', // Fase 2: stakeholders del cliente — owner y recruiter
  'finanzas_log', // registro de cambios de Finanzas — solo lectura, solo owner
  'tipo_cambio', // tipo de cambio oficial por mes — owner
  'client_finanzas', // plazo de pago por cliente — owner
  'lead_contacts', // Fase 2: contacto comercial de un lead — solo owner
]);

// Tablas de uso rutinario de cualquier recruiter (no solo owner) — a
// diferencia de billing/facturas/nómina/usuarios, que siguen siendo
// exclusivas del owner.
const RECRUITER_TABLES = new Set([
  'candidate_presentations',
  'outreach_sequences',
  'outreach_sequence_steps',
  'word_download_log',
  'client_stakeholders',
]);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Finanzas-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { table, ...rawParams } = req.query || {};
  if (!table || !ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Tabla no permitida' });
  }

  // Excepción puntual: cualquier recruiter puede crear (no leer/editar/borrar)
  // un registro de billing al cerrar una contratación (ver HireModal en el
  // ATS). Las tablas en RECRUITER_TABLES son de uso diario de cualquier
  // recruiter en todas las operaciones. El resto sigue siendo solo owner.
  const allowedRoles =
    table === 'billing' && req.method === 'POST' ? ['owner', 'recruiter']
    : RECRUITER_TABLES.has(table) ? ['owner', 'recruiter']
    : ['owner'];
  const session = requireRole(req, res, allowedRoles);
  if (!session) return;

  // El registro de cambios es de solo lectura: lo escribe este mismo archivo.
  if (table === 'finanzas_log' && req.method !== 'GET') return res.status(405).json({ error: 'Solo lectura' });

  // PIN de Finanzas: las tablas de plata exigen el token que entrega
  // api/finanzas-pin.js después de validar el PIN. Excepción: billing POST
  // (cualquier recruiter crea el registro al confirmar un hire). Mientras
  // ENFORCE_PIN sea false el servidor deja pasar pedidos sin token (período de
  // transición, ver _finanzas.js).
  const exigePin = FINANZAS_TABLES.has(table) || table === 'tipo_cambio' || table === 'client_finanzas';
  const esAltaDeHire = table === 'billing' && req.method === 'POST';
  if (ENFORCE_PIN && exigePin && !esAltaDeHire && !hasFinanzasToken(req, session)) {
    return res.status(403).json({ error: 'PIN de Finanzas requerido', code: 'finanzas_pin' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rawParams)) {
    if (Array.isArray(v)) v.forEach((vv) => params.append(k, vv));
    else if (v !== undefined) params.append(k, v);
  }

  const baseHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const stripPassword = (row) => {
    if (!row || typeof row !== 'object') return row;
    const { password, ...rest } = row;
    return rest;
  };
  const sanitize = (data) => {
    if (table !== 'users') return data;
    return Array.isArray(data) ? data.map(stripPassword) : stripPassword(data);
  };

  // Registro de cambios (finanzas_log). Quién (mail de la sesión), cuándo (la
  // base pone la fecha), qué tabla/fila, y el antes/después de lo que cambió.
  const logueada = LOGGED_TABLES.has(table);
  const usuario = { id: session.id, email: session.email };
  const filtrosSolo = () => {
    const q = new URLSearchParams(params);
    ['select', 'order', 'limit', 'offset'].forEach((k) => q.delete(k));
    q.set('select', '*');
    return q;
  };
  const leerFilas = async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filtrosSolo()}`, { headers: baseHeaders });
    const d = await r.json();
    if (!r.ok) throw new Error('No se pudieron leer las filas previas');
    return d;
  };
  const escribirLog = async (filas) => {
    if (!filas.length) return true;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/finanzas_log`, {
      method: 'POST', headers: { ...baseHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(filas),
    });
    if (!r.ok) console.error('finanzas_log: no se pudo escribir', await r.text());
    return r.ok;
  };

  try {
    if (req.method === 'GET') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: baseHeaders });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (table === 'users') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) {
          if (r.password) r.password = await bcrypt.hash(r.password, 10);
        }
        body = rows;
      }
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      if (logueada) {
        await escribirLog((Array.isArray(data) ? data : [data]).map((f) => ({
          user_id: usuario.id, user_name: usuario.email, tabla: table, row_id: String(f.id), accion: 'crear', antes: null, despues: f,
        })));
      }
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'PATCH') {
      const body = { ...(req.body || {}) };
      if (table === 'users') {
        if (body.password) body.password = await bcrypt.hash(body.password, 10);
        else delete body.password; // nunca pisar el hash existente con string vacío
      }
      const filasPrevias = logueada ? await leerFilas() : [];
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      if (logueada) await escribirLog(filasLogPatch({ tabla: table, filas: filasPrevias, body, usuario }));
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'DELETE') {
      // Se loguea ANTES de borrar y con la fila completa: no se puede borrar
      // plata sin dejar rastro (si el log falla, no se borra).
      if (logueada) {
        const filas = await leerFilas();
        const ok = await escribirLog(filas.map((f) => ({
          user_id: usuario.id, user_name: usuario.email, tabla: table, row_id: String(f.id), accion: 'borrar', antes: f, despues: null,
        })));
        if (!ok) return res.status(500).json({ error: 'No se pudo registrar el borrado; no se borró nada' });
      }
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        method: 'DELETE',
        headers: baseHeaders,
      });
      if (!resp.ok) {
        const t = await resp.text();
        return res.status(resp.status).json({ error: t });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('owner-data error:', e);
    return res.status(500).json({ error: e.message });
  }
};
