// Helpers compartidos por los endpoints que llama el portal de clientes.
// El portal no tiene sesión del ATS: se identifica con el portal_token del
// cliente (clients.portal_token, con portal_active=true). Nunca se confía
// en nombres, ids ni mails que mande el portal — se resuelven acá.

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

// Cliente {id, name} de un portal activo, o null.
async function resolvePortalClient(portalToken) {
  if (typeof portalToken !== 'string' || !portalToken) return null;
  const rows = await sbGet(`clients?portal_token=eq.${encodeURIComponent(portalToken)}&portal_active=eq.true&select=id,name`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
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

module.exports = { EMAIL_RE, escapeHtml, resolvePortalClient, findClientRecruiter };
