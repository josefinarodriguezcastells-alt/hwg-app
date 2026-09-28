// api/login.js
// Login server-side: compara el password contra el hash bcrypt guardado en
// Supabase, usando la service key (nunca expuesta al browser). Reemplaza el
// login anterior, que comparaba texto plano directo desde el cliente con la
// clave anónima de Supabase.

const bcrypt = require('bcryptjs');
const { signSession } = require('./_auth');

// Auditoría de los 20 endpoints: no había ningún límite de intentos —
// alguien podía probar contraseñas para un email sin ningún freno. Cada
// intento fallido (nunca uno exitoso, ni la contraseña probada) se guarda
// en login_attempts (sql/login-attempts-table.sql); si hay MAX_ATTEMPTS o
// más en los últimos WINDOW_MINUTES para ese email, se corta acá — antes
// de tocar Supabase por el usuario o comparar el hash — con 429.
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

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

  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  // Registrar el intento fallido nunca debe ser lo que tira el 500 de un
  // login que en realidad falló por credenciales — mejor un intento no
  // contado que una respuesta rota.
  const logFailedAttempt = async (emailNorm) => {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/login_attempts`, {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify([{ email: emailNorm }]),
      });
    } catch (e) {
      console.error('login: no se pudo registrar el intento fallido', e);
    }
  };

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    // emailNorm es solo para CONTAR intentos (sin distinguir mayúsculas, así
    // no se esquiva el límite escribiéndolo distinto cada vez) — la consulta
    // a `users` de abajo sigue usando `email` tal cual lo mandaron, como
    // hacía antes. Hay emails reales guardados con mayúsculas de mitad de
    // palabra (ej. "Majulcarlaa@gmail.com"), y `eq.` en PostgREST distingue
    // mayúsculas: normalizarlo ahí rompería el login de esas cuentas.
    const emailNorm = String(email).trim().toLowerCase();

    const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
    const attemptsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/login_attempts?email=eq.${encodeURIComponent(emailNorm)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      { headers: dbHeaders }
    );
    if (attemptsResp.ok) {
      const attempts = await attemptsResp.json();
      if (Array.isArray(attempts) && attempts.length >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: `Demasiados intentos. Esperá ${WINDOW_MINUTES} minutos e intentá de nuevo.` });
      }
    } else {
      // Si el conteo falla, mejor loguear y seguir que bloquear un login
      // legítimo por un problema ajeno a las credenciales.
      console.error('login: no se pudo consultar login_attempts', await attemptsResp.text());
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=*`,
      { headers: dbHeaders }
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
      await logFailedAttempt(emailNorm);
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logFailedAttempt(emailNorm);
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
