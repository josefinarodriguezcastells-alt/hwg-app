const { requireRole } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, model, max_tokens } = req.body || {};

    // Paso 1 de 3 para cerrar este endpoint (cuesta créditos de IA de HWG por
    // uso y no pedía nada): si viene sesión del ATS, se valida; si no viene,
    // todavía se deja pasar porque el ATS en producción aún no la manda.
    // Cuando el ATS que la manda esté deployado, pasa a exigirse siempre.
    // El portal de clientes ya no pasa por acá: usa /api/portal-analysis,
    // que arma el prompt en el servidor.
    if (req.headers.authorization) {
      if (!requireRole(req, res, ['owner', 'recruiter'])) return;
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
