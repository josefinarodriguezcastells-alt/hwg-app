// api/portal-verify.js
// Pantalla de PIN del portal de clientes (ClientPortal.jsx). Antes el
// navegador comparaba el PIN con una consulta directa a `clients` usando la
// clave anónima, lo que obligaba a dejar clients.portal_pin legible para
// cualquiera. Ahora el PIN vive en client_secrets (sin acceso anónimo) y se
// valida acá, con límite de intentos (ver verifyPortalPin en _portal.js).
//
// Devuelve solo las columnas que el portal necesita después de entrar —
// nunca el PIN — y una sesión corta de portal (12 h) que usan los pedidos de
// datos del portal (api/portal-db) en vez de volver a mandar el PIN cada vez.

const { verifyPortalPin } = require('./_portal');
const { signPortal } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }

  const { portal_token, portal_pin } = req.body || {};
  try {
    const result = await verifyPortalPin(req, portal_token, portal_pin);
    if (!result.client) return res.status(result.status).json({ error: result.error });

    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(result.client.id)}&select=id,name,cultural_tags,cultural_comment,portal_permissions`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await resp.json();
    if (!resp.ok || !rows[0]) return res.status(500).json({ error: 'No se pudo cargar el portal' });
    return res.status(200).json({ client: rows[0], session: signPortal(rows[0].id) });
  } catch (e) {
    console.error('portal-verify error:', e);
    return res.status(500).json({ error: 'Error validando el PIN' });
  }
};
