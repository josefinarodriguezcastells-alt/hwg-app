module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    supabaseUrl:  process.env.SUPABASE_URL,
    supabaseKey:  process.env.SUPABASE_ANON_KEY,
    appUrl:       process.env.APP_URL || 'https://hwg-app.vercel.app',
  });
};
