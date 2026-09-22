// api/portal-presentations.js
// Endpoint público (el portal de un cliente no tiene login con JWT, se
// identifica con su portal_token) para que el portal muestre los links de
// informe ya publicados de sus propios candidatos — reemplaza el fetch
// directo a candidate_presentations con la clave anónima (2026-09-22,
// hallazgo de seguridad).
//
// No confía en candidate_id/position_id que mande el cliente: resuelve el
// cliente a partir del portal_token (misma validación que ya hace el
// portal contra la tabla clients) y él mismo calcula cuáles son las
// posiciones de ESE cliente — así un portal no puede pedir informes de
// otro cliente aunque le pase sus ids a mano.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { portal_token, candidate_ids } = req.body || {};
  if (!portal_token) return res.status(400).json({ error: 'Falta portal_token' });
  if (!Array.isArray(candidate_ids) || candidate_ids.length === 0) return res.status(200).json([]);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  const baseHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

  try {
    const clientResp = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?portal_token=eq.${encodeURIComponent(portal_token)}&portal_active=eq.true&select=id`,
      { headers: baseHeaders }
    );
    const clientRows = await clientResp.json();
    const client = Array.isArray(clientRows) ? clientRows[0] : null;
    if (!client) return res.status(403).json({ error: 'Portal inválido' });

    const posResp = await fetch(
      `${SUPABASE_URL}/rest/v1/positions?client_id=eq.${client.id}&select=id`,
      { headers: baseHeaders }
    );
    const positions = await posResp.json();
    const posIds = (positions || []).map(p => p.id);
    if (posIds.length === 0) return res.status(200).json([]);

    const candFilter = candidate_ids.map(id => `"${id}"`).join(',');
    const posFilter = posIds.map(id => `"${id}"`).join(',');
    const presResp = await fetch(
      `${SUPABASE_URL}/rest/v1/candidate_presentations?candidate_id=in.(${candFilter})&position_id=in.(${posFilter})&select=candidate_id,position_id,token,published_at&order=published_at.desc`,
      { headers: baseHeaders }
    );
    const data = await presResp.json();
    if (!presResp.ok) return res.status(presResp.status).json({ error: data });
    return res.status(200).json(data);
  } catch (e) {
    console.error('portal-presentations error:', e);
    return res.status(500).json({ error: e.message });
  }
};
