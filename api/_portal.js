// Helpers compartidos por los endpoints que llama el portal de clientes.
// El portal no tiene sesión del ATS: se identifica con el portal_token del
// cliente (clients.portal_token, con portal_active=true). Nunca se confía
// en nombres, ids ni mails que mande el portal — se resuelven acá.

const { requireRole } = require('./_auth');

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function sbGet(path) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: supabaseHeaders() });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

// Cliente {id, name} de un portal activo, o null. No mira el PIN — para eso
// está verifyPortalPin (el PIN vive en client_secrets, que la clave anónima
// no puede leer).
async function resolvePortalClient(portalToken) {
  if (typeof portalToken !== 'string' || !portalToken) return null;
  const rows = await sbGet(`clients?portal_token=eq.${encodeURIComponent(portalToken)}&portal_active=eq.true&select=id,name`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Un PIN de 4 dígitos son solo 10.000 combinaciones: sin freno se prueban
// todas en minutos. Mismo mecanismo que api/login.js (record_login_attempt /
// clear_login_attempts, ver sql/login-attempts-table.sql), con la clave
// `portal:<token>` + IP. 10 intentos por 15 minutos alcanzan de sobra para
// alguien que se equivoca tipeando.
const PIN_MAX_ATTEMPTS = 10;
const PIN_WINDOW_MINUTES = 15;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || 'sin-ip';
}

async function sbRpc(fn, args) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(args),
  });
}

// Valida token + PIN contra client_secrets. Devuelve {client:{id,name}} si
// es correcto, o {status, error} si no (el caller responde con eso). Falla
// cerrado: si no se puede contar el intento, no se deja pasar.
async function verifyPortalPin(req, portalToken, portalPin) {
  if (typeof portalToken !== 'string' || !portalToken) return { status: 400, error: 'Falta el portal_token' };
  if (typeof portalPin !== 'string' || !portalPin) return { status: 400, error: 'portal_pin inválido' };

  const key = `portal:${portalToken}`;
  const ip = clientIp(req);
  const attemptResp = await sbRpc('record_login_attempt', { p_email: key, p_ip: ip, p_window_minutes: PIN_WINDOW_MINUTES });
  if (!attemptResp.ok) {
    console.error('verifyPortalPin: record_login_attempt falló', await attemptResp.text());
    return { status: 500, error: 'No se pudo validar el PIN, intentá de nuevo' };
  }
  const [{ recent_count } = {}] = await attemptResp.json();
  if (recent_count > PIN_MAX_ATTEMPTS) {
    return { status: 429, error: `Demasiados intentos. Esperá ${PIN_WINDOW_MINUTES} minutos e intentá de nuevo.` };
  }

  const client = await resolvePortalClient(portalToken);
  if (!client) return { status: 403, error: 'Portal o PIN inválido' };
  const rows = await sbGet(`client_secrets?client_id=eq.${encodeURIComponent(client.id)}&portal_pin=eq.${encodeURIComponent(portalPin)}&select=client_id`);
  if (!Array.isArray(rows) || !rows[0]) return { status: 403, error: 'Portal o PIN inválido' };

  // PIN correcto: se libera el contador (best-effort, igual que en login).
  await sbRpc('clear_login_attempts', { p_email: key, p_ip: ip }).catch(() => null);
  return { client };
}

// Auditoría de los 20 endpoints: portal-candidate-action, notify-message,
// notify-portal-feedback y notify (POST) escriben datos reales o mandan
// mails con la marca de HWG confiando solo en portal_token — que viaja en
// la URL del portal (/portal/:token), así que por sí solo no prueba que
// quien llama pasó la pantalla de PIN (mismo hallazgo que ya se cerró para
// portal-analysis, hwg-app#19/#20). Este helper aplica el mismo criterio a
// los cuatro: portal_pin (el que el cliente tipeó al entrar) o la sesión
// del ATS de un owner (que entra al portal por el bypass de whoami, sin
// PIN). Devuelve el cliente {id,name} si es válido; si no, ya mandó la
// respuesta de error (401 sin PIN, 400 con portal_pin mal armado, 403 con
// credenciales que no matchean) y el caller tiene que cortar.
//
// Se cerró en 3 pasos para no cortar producción (hwg-app#25 tuvo un
// `required: false` transitorio mientras hwg_ats#64 —el frontend que manda
// el PIN— terminaba de deployarse). Confirmado en producción, así que este
// paso 3 saca el flag: ahora un pedido sin PIN ni sesión de owner se
// rechaza siempre.
async function resolvePortalWriter(req, res, portalToken, portalPin) {
  if (req.headers.authorization) {
    if (!requireRole(req, res, ['owner'])) return null;
    const client = await resolvePortalClient(portalToken);
    if (!client) { res.status(403).json({ error: 'Portal inválido' }); return null; }
    return client;
  }
  if (portalPin == null || portalPin === '') {
    res.status(401).json({ error: 'Falta el PIN del portal' });
    return null;
  }
  if (typeof portalPin !== 'string') {
    res.status(400).json({ error: 'portal_pin inválido' });
    return null;
  }
  const result = await verifyPortalPin(req, portalToken, portalPin);
  if (!result.client) { res.status(result.status).json({ error: result.error }); return null; }
  return result.client;
}

// Recruiter {email, name} asignado a alguna posición del cliente cuyo mail
// sea `email` (sin distinguir mayúsculas), o null. Mismo criterio que la
// lista "tu recruiter" del portal (position_recruiters). Consultas
// puntuales —el usuario por mail, y a lo sumo una asignación— para no
// depender del límite de filas de Supabase con clientes grandes.
async function findClientRecruiter(clientId, email) {
  const wanted = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(wanted)) return null;
  // ilike trae candidatos sin distinguir mayúsculas; si el mail tiene _ o %
  // actúan de comodín y pueden traer de más, nunca de menos — por eso se
  // filtra por igualdad exacta abajo en vez de escaparlos. Sin limit: con
  // un tope, los "de más" podían dejar afuera al mail exacto.
  const users = await sbGet(`users?email=ilike.${encodeURIComponent(wanted)}&select=id,email,name`);
  const matches = users.filter(u => String(u.email || '').toLowerCase() === wanted);
  if (!matches.length) return null;
  const positions = await sbGet(`positions?client_id=eq.${encodeURIComponent(clientId)}&select=id`);
  if (!positions.length) return null;
  const posIds = positions.map(p => encodeURIComponent(p.id)).join(',');
  for (const u of matches) {
    const link = await sbGet(`position_recruiters?recruiter_id=eq.${encodeURIComponent(u.id)}&position_id=in.(${posIds})&select=position_id&limit=1`);
    if (link.length) return { email: u.email, name: u.name };
  }
  return null;
}

module.exports = { EMAIL_RE, escapeHtml, resolvePortalClient, resolvePortalWriter, verifyPortalPin, findClientRecruiter };
