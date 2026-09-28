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

// Recruiters asignados a alguna posición del cliente: [{email, name}] —
// mismo criterio que la lista "tu recruiter" del portal (position_recruiters).
async function clientRecruiters(clientId) {
  const positions = await sbGet(`positions?client_id=eq.${encodeURIComponent(clientId)}&select=id`);
  const posIds = positions.map(p => p.id);
  if (!posIds.length) return [];
  const links = await sbGet(`position_recruiters?position_id=in.(${posIds.map(encodeURIComponent).join(',')})&select=recruiter_id`);
  const userIds = [...new Set(links.map(l => l.recruiter_id).filter(Boolean))];
  if (!userIds.length) return [];
  const users = await sbGet(`users?id=in.(${userIds.map(encodeURIComponent).join(',')})&select=email,name`);
  return users.filter(u => u.email);
}

module.exports = { EMAIL_RE, escapeHtml, resolvePortalClient, clientRecruiters };
