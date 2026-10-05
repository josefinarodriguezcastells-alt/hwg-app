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
const { requireRole } = require('./_auth');

const ALLOWED_TABLES = new Set([
  'billing',
  'facturas',
  'embedded_nomina_personas',
  'embedded_nomina',
  'entidades_facturadoras',
  'factura_items',
  'finanzas_auditoria',
  'users',
  'candidate_presentations',
  'outreach_sequences',
  'outreach_sequence_steps',
  'word_download_log',
]);

// Solo lectura desde acá: factura_items y finanzas_auditoria las escriben las
// funciones de facturación (api/finanzas-facturas.js) y los triggers de la base.
const READ_ONLY_TABLES = new Set(['factura_items', 'finanzas_auditoria']);

// Tablas donde cada alta/cambio/baja deja al usuario de la sesión como autor
// (la base lo guarda en updated_by y lo copia a finanzas_auditoria).
const AUDITED_TABLES = new Set(['billing', 'facturas']);

// Campos de facturas que solo pueden cambiar las funciones de facturación
// (emitir / anular / cobrar), nunca un PATCH suelto: el número, los montos y
// el estado son lo que se audita.
const FACTURAS_PROTEGIDOS = [
  'numero', 'total', 'items', 'moneda', 'client_id', 'tipo', 'estado', 'fecha_cobro',
  'emitida_at', 'emitida_por', 'fecha_emision', 'tc_dia',
  'anulada_at', 'anulada_por', 'anulada_motivo', 'created_by', 'created_at',
];

// Tablas de uso rutinario de cualquier recruiter (no solo owner) — a
// diferencia de billing/facturas/nómina/usuarios, que siguen siendo
// exclusivas del owner.
const RECRUITER_TABLES = new Set([
  'candidate_presentations',
  'outreach_sequences',
  'outreach_sequence_steps',
  'word_download_log',
]);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { table, ...rawParams } = req.query || {};
  if (!table || !ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: 'Tabla no permitida' });
  }
  if (READ_ONLY_TABLES.has(table) && req.method !== 'GET' && req.method !== 'OPTIONS') {
    return res.status(405).json({ error: 'Esta tabla es de solo lectura' });
  }
  if (table === 'facturas' && req.method === 'POST') {
    return res.status(405).json({ error: 'Las facturas se emiten con /api/finanzas-facturas (numeración correlativa).' });
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
  // El autor sale siempre de la sesión (JWT), nunca de lo que mande el cliente.
  const stamp = (body) => {
    const marca = { updated_by: session.id, updated_at: new Date().toISOString() };
    return Array.isArray(body) ? body.map((r) => ({ ...r, ...marca })) : { ...body, ...marca };
  };
  // Antes de correr la migración de Finanzas (2026-10-05b) las columnas
  // updated_by/updated_at no existen y PostgREST rechaza el pedido. Para no
  // cortar escrituras de producción (incluida la alta de billing que hace un
  // recruiter al confirmar una contratación) se reintenta sin el sello: la
  // auditoría arranca sola apenas existe la columna.
  const sinSello = (body) => {
    const quitar = ({ updated_by, updated_at, ...resto }) => resto;
    return Array.isArray(body) ? body.map(quitar) : quitar(body);
  };
  const sendConSello = async (method, body, headers) => {
    const go = (b) => fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { method, headers, body: JSON.stringify(b) });
    let resp = await go(body);
    if (!resp.ok && AUDITED_TABLES.has(table)) {
      const texto = await resp.clone().text();
      if (/updated_by|updated_at/.test(texto)) resp = await go(sinSello(body));
    }
    return resp;
  };
  const sanitize = (data) => {
    if (table !== 'users') return data;
    return Array.isArray(data) ? data.map(stripPassword) : stripPassword(data);
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
      if (AUDITED_TABLES.has(table)) body = stamp(body);
      const resp = await sendConSello('POST', body, { ...baseHeaders, Prefer: 'return=representation' });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'PATCH') {
      const body = { ...(req.body || {}) };
      if (table === 'users') {
        if (body.password) body.password = await bcrypt.hash(body.password, 10);
        else delete body.password; // nunca pisar el hash existente con string vacío
      }
      if (table === 'facturas') {
        const prohibidos = FACTURAS_PROTEGIDOS.filter((k) => k in body);
        if (prohibidos.length) {
          return res.status(400).json({ error: `Estos campos de una factura solo se cambian emitiendo, anulando o cobrando desde Finanzas: ${prohibidos.join(', ')}.` });
        }
      }
      if (table === 'billing' && 'factura_id' in body) {
        return res.status(400).json({ error: 'El vínculo con la factura solo lo maneja la facturación.' });
      }
      const patchBody = AUDITED_TABLES.has(table) ? stamp(body) : body;
      const resp = await sendConSello('PATCH', patchBody, { ...baseHeaders, Prefer: 'return=representation' });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'DELETE') {
      if (AUDITED_TABLES.has(table)) {
        // Queda quién borró: el trigger de auditoría guarda updated_by de la fila.
        await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
          method: 'PATCH',
          headers: baseHeaders,
          body: JSON.stringify(stamp({})),
        }).catch(() => null);
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
