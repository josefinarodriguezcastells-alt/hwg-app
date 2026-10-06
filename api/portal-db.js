// api/portal-db.js
// Proxy de datos del PORTAL de clientes. El portal (ClientPortal.jsx) sigue
// usando supabase.from(...), pero sus pedidos salen por acá (ver
// hwg_ats/app/src/lib/dbProxy.js) en vez de ir a Supabase con la clave pública.
//
// Quién es el visitante lo dice una sesión de portal ({kind:'portal', cid}),
// que entrega api/portal-verify cuando el PIN es correcto. El único pedido
// sin sesión es el de la pantalla del PIN (nombre de la empresa dado su
// portal_token). Nada de lo que acá se reenvía confía en ids o filtros del
// navegador: el cliente (cid) sale de la sesión y se fuerza en cada consulta.
//
//   /api/portal-db?__t=<tabla>&<querystring de PostgREST>

const { verifyPortal } = require('./_auth');
const { columnasLectura, restringirSelect, validarFiltros, sanearEscritura, TABLAS_LECTURA } = require('./_portal-policy');

const HEADERS_PASAN = ['accept', 'content-type', 'prefer', 'range', 'range-unit'];
const HEADERS_VUELVEN = ['content-type', 'content-range', 'preference-applied'];
const NADA = '00000000-0000-0000-0000-000000000000';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Prefer, Range, Range-Unit, Accept, Accept-Profile, Content-Profile, X-Client-Info, X-Supabase-Api-Version, X-Portal-Token');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Preference-Applied');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'HEAD', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  const leer = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders });
    if (!r.ok) throw new Error('lectura falló: ' + r.status);
    return r.json();
  };

  const entrada = new URLSearchParams(new URL(req.url, 'http://x').search);
  const tabla = entrada.get('__t');
  entrada.delete('__t');
  const esLectura = req.method === 'GET' || req.method === 'HEAD';

  try {
    // ── Quién es ────────────────────────────────────────────────────────
    const ses = verifyPortal(req);
    let cid, perms = {}, preLogin = false;
    if (ses) {
      cid = ses.cid;
      const c = await leer(`clients?id=eq.${encodeURIComponent(cid)}&portal_active=eq.true&select=id,portal_permissions`);
      if (!c[0]) return res.status(403).json({ error: 'Portal inactivo' });
      perms = c[0].portal_permissions || {};
    } else {
      // Pantalla del PIN: solo "¿qué empresa es este link?" — id, nombre y si
      // está activo, y nada más.
      const tokenLink = req.headers['x-portal-token'];
      if (!tokenLink || typeof tokenLink !== 'string' || tabla !== 'clients' || !esLectura) return res.status(401).json({ error: 'Falta la sesión del portal' });
      preLogin = true;
      entrada.set('portal_token', 'eq.' + tokenLink);
      entrada.set('portal_active', 'eq.true');
    }

    // ── Plan de la consulta ────────────────────────────────────────────
    const q = new URLSearchParams(entrada);
    let body;
    if (esLectura) {
      const cols = columnasLectura(tabla, perms, preLogin);
      if (cols === undefined || !TABLAS_LECTURA.includes(tabla)) return res.status(400).json({ error: 'Tabla no permitida' });
      const sel = restringirSelect(q.get('select'), cols);
      if (sel.error) return res.status(400).json({ error: sel.error });
      // En la pantalla del PIN el filtro por portal_token es el propio pedido.
      const motivoFiltro = validarFiltros(entrada, cols && tabla === 'clients' ? [...cols, 'portal_token'] : cols);
      if (motivoFiltro) return res.status(400).json({ error: motivoFiltro });
      q.set('select', sel.select);
    } else {
      const s = sanearEscritura({ tabla, metodo: req.method, body: req.body, cid });
      if (s.error) return res.status(403).json({ error: s.error });
      body = JSON.stringify(Array.isArray(req.body) ? s.body : s.body[0] ?? s.body);
      q.delete('select');
      if (req.method === 'POST') { /* nada más: client_id ya viene forzado en el cuerpo */ }
    }

    // ── Forzar el alcance al cliente de la sesión ─────────────────────
    // Los filtros que mandó el navegador se conservan (se combinan con AND),
    // pero el alcance lo agrega el servidor y no se puede esquivar con `or=`.
    if (!preLogin) {
      const posIds = tabla === 'positions' || tabla === 'client_portal_visibility' || tabla === 'client_portal_notes' || tabla === 'client_portal_activity' || tabla === 'client_position_requests' || tabla === 'clients'
        ? null
        : (await leer(`positions?client_id=eq.${encodeURIComponent(cid)}&select=id`)).map((p) => p.id);
      switch (tabla) {
        case 'positions': case 'client_portal_visibility': case 'client_portal_notes': case 'client_portal_activity': case 'client_position_requests':
          if (esLectura || req.method === 'PATCH') q.append('client_id', 'eq.' + cid);
          break;
        case 'clients':
          q.append('id', 'eq.' + cid);
          break;
        case 'applications': case 'position_recruiters':
          q.append('position_id', `in.(${posIds.length ? posIds.join(',') : NADA})`);
          break;
        case 'candidates': {
          const apps = posIds.length ? await leer(`applications?position_id=in.(${posIds.join(',')})&select=candidate_id`) : [];
          const ids = [...new Set(apps.map((a) => a.candidate_id).filter(Boolean))];
          q.append('id', `in.(${ids.length ? ids.join(',') : NADA})`);
          break;
        }
        default: break;
      }
      // Escrituras con ids propios: que apunten a recursos de este cliente.
      if (req.method === 'POST') {
        const filas = JSON.parse(body);
        const lista = Array.isArray(filas) ? filas : [filas];
        const candIds = [...new Set(lista.map((f) => f.candidate_id).filter(Boolean))];
        const appIds = [...new Set(lista.map((f) => f.application_id).filter(Boolean))];
        const propios = posIds === null ? (await leer(`positions?client_id=eq.${encodeURIComponent(cid)}&select=id`)).map((p) => p.id) : posIds;
        if (appIds.length) {
          const ok = propios.length ? await leer(`applications?id=in.(${appIds.map(encodeURIComponent).join(',')})&position_id=in.(${propios.join(',')})&select=id`) : [];
          if (ok.length !== appIds.length) return res.status(403).json({ error: 'Postulación ajena' });
        }
        if (candIds.length) {
          const apps = propios.length ? await leer(`applications?candidate_id=in.(${candIds.map(encodeURIComponent).join(',')})&position_id=in.(${propios.join(',')})&select=candidate_id`) : [];
          const ok = new Set(apps.map((a) => a.candidate_id));
          if (candIds.some((i) => !ok.has(i))) return res.status(403).json({ error: 'Candidato ajeno' });
        }
      }
    }

    // ── Reenvío ────────────────────────────────────────────────────────
    const headers = { ...dbHeaders };
    for (const h of HEADERS_PASAN) if (req.headers[h]) headers[h] = req.headers[h];
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${q.toString()}`, { method: req.method, headers, body });
    for (const h of HEADERS_VUELVEN) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
    res.statusCode = r.status;
    if (req.method === 'HEAD' || r.status === 204) return res.end();
    return res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('portal-db error:', e);
    return res.status(502).json({ error: 'No se pudo consultar la base' });
  }
};
