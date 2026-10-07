// api/db.js
// Proxy autenticado hacia PostgREST para las tablas del ATS (candidatos,
// postulaciones, posiciones, scorecards, clientes, portal...). El frontend
// (lib/supabase.js) reescribe cada pedido de supabase-js a esta URL con la
// sesión del ATS en Authorization, así las pantallas siguen usando
// supabase.from(...) tal cual y la tabla se puede cerrar a la clave anónima.
//
// Se reenvía el pedido casi tal cual (método, querystring, cuerpo, y los
// headers que supabase-js usa: Prefer, Range, Accept), con la clave de
// servicio. Como esa clave ignora RLS, las reglas viven en _db-policy.js:
// tablas permitidas, roles, y qué relaciones se pueden incrustar.
//
//   /api/db?__t=<tabla>&<querystring original de PostgREST>

const { requireRole } = require('./_auth');
const { armarConsulta } = require('./_db-policy');
const { claveServicio, cabecerasServicio } = require('./_supabase');

const HEADERS_PASAN = ['accept', 'content-type', 'prefer', 'range', 'range-unit'];
const HEADERS_VUELVEN = ['content-type', 'content-range', 'preference-applied'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Prefer, Range, Range-Unit, Accept, Accept-Profile, Content-Profile, X-Finanzas-Token, X-Client-Info, X-Supabase-Api-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Preference-Applied');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner', 'recruiter']);
  if (!session) return;

  const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY = claveServicio();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });

  const entrada = new URLSearchParams(new URL(req.url, 'http://x').search);
  const tabla = entrada.get('__t');
  entrada.delete('__t');

  const plan = armarConsulta({ tabla, rol: session.role, metodo: req.method, entrada, body: req.body });
  if (plan.error) return res.status(plan.status).json({ error: plan.error });

  const headers = { ...cabecerasServicio() };
  for (const h of HEADERS_PASAN) if (req.headers[h]) headers[h] = req.headers[h];

  let body;
  if (req.method === 'POST' || req.method === 'PATCH') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    headers['content-type'] = headers['content-type'] || 'application/json';
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}${plan.query ? '?' + plan.query : ''}`, { method: req.method, headers, body });
    for (const h of HEADERS_VUELVEN) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
    res.statusCode = r.status;
    if (req.method === 'HEAD' || r.status === 204) return res.end();
    return res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('db proxy error:', e);
    return res.status(502).json({ error: 'No se pudo consultar la base' });
  }
};
