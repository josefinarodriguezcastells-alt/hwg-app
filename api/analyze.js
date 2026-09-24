const { requireRole } = require('./_auth');

// El portal de clientes no tiene sesión del ATS: se identifica con su
// portal_token (mismo criterio que portal-presentations.js). Por ese camino
// el modelo y el largo quedan fijos a lo que usa el portal ("Análisis de la
// búsqueda" en ClientPortal.jsx), así un link de portal no sirve para
// consumir un modelo caro con respuestas largas.
const PORTAL_MODEL = 'claude-haiku-4-5-20251001';
const PORTAL_MAX_TOKENS = 500;

async function portalActivo(portalToken) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Variables de entorno de Supabase no configuradas');
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?portal_token=eq.${encodeURIComponent(portalToken)}&portal_active=eq.true&select=id`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!resp.ok) throw new Error('No se pudo validar el portal');
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length > 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, portal_token } = req.body || {};
    let { model, max_tokens } = req.body || {};

    // Paso 1 de 3 para cerrar este endpoint (cuesta créditos de IA de HWG por
    // uso y no pedía nada): si viene sesión del ATS o portal_token, se
    // validan; si no viene ninguno, todavía se deja pasar porque el ATS en
    // producción aún no los manda. Cuando el ATS que los manda esté
    // deployado, pasa a exigirse uno de los dos siempre.
    if (req.headers.authorization) {
      if (!requireRole(req, res, ['owner', 'recruiter'])) return;
    } else if (portal_token) {
      if (!(await portalActivo(String(portal_token)))) return res.status(403).json({ error: 'Portal inválido' });
      model = PORTAL_MODEL;
      max_tokens = Math.min(Number(max_tokens) || PORTAL_MAX_TOKENS, PORTAL_MAX_TOKENS);
    }

    if (!prompt) return res.status(400).json({ error: 'prompt requerido' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Claude error');

    return res.status(200).json({ content: data.content });
  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ error: err.message });
  }
};
