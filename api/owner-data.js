// api/owner-data.js
// Proxy genérico y protegido hacia Supabase para las tablas que hoy se leen
// y escriben directo desde el browser con la clave anónima: billing, facturas,
// embedded_nomina_personas, embedded_nomina, entidades_facturadoras, users.
//
// Requiere un JWT válido con rol 'owner' (ver _auth.js). Usa la service key
// de Supabase server-side — la clave anónima ya no necesita (ni debería tener)
// acceso a estas tablas una vez que se aplique el RLS lockdown.
//
// El querystring que manda el cliente (select/order/limit/filtros eq/not, etc.)
// se reenvía tal cual a PostgREST — es exactamente lo que supabase-js arma
// internamente, así que el shim del frontend (secureTable en index.html) puede
// mantener la misma sintaxis de encadenado que ya se usaba.

const bcrypt = require('bcryptjs');
const { requireRole } = require('./_auth');

const ALLOWED_TABLES = new Set([
  'billing',
  'facturas',
  'embedded_nomina_personas',
  'embedded_nomina',
  'entidades_facturadoras',
  'users',
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

  // Excepción puntual: cualquier recruiter puede crear (no leer/editar/borrar)
  // un registro de billing al cerrar una contratación (ver HireModal en el
  // ATS) — el resto de las tablas y operaciones siguen siendo solo owner.
  const allowedRoles =
    table === 'billing' && req.method === 'POST' ? ['owner', 'recruiter'] : ['owner'];
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
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
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
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      return res.status(200).json(sanitize(data));
    }

    if (req.method === 'DELETE') {
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
