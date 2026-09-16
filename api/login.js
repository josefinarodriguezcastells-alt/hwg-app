// api/login.js
// Login server-side: compara el password contra el hash bcrypt guardado en
// Supabase, usando la service key (nunca expuesta al browser). Reemplaza el
// login anterior, que comparaba texto plano directo desde el cliente con la
// clave anónima de Supabase.

const bcrypt = require('bcryptjs');
const { signSession } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!resp.ok) {
      console.error('login: supabase query failed', await resp.text());
      return res.status(500).json({ error: 'Error consultando usuarios' });
    }

    const rows = await resp.json();
    const user = rows[0];

    // Mismo mensaje de error si el usuario no existe o si la contraseña no
    // matchea, para no revelar qué emails están registrados.
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const { password: _omit, ...safeUser } = user;
    const token = signSession(safeUser);
    return res.status(200).json({ ...safeUser, token });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: e.message });
  }
};
