// Configuración pública para las páginas sueltas (index.html, perfil.html).
// Ya no devuelve ninguna clave de Supabase: esas páginas no hablan con la base
// (usan /api/presentation, /api/generate, etc.) y la clave anon legacy está apagada.
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    supabaseUrl:  process.env.SUPABASE_URL,
    appUrl:       process.env.APP_URL || 'https://hwg-app.vercel.app',
  });
};
