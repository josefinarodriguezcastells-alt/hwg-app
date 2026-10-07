// api/login.js
// Login server-side: compara el password contra el hash bcrypt guardado en
// Supabase, usando la service key (nunca expuesta al browser). Reemplaza el
// login anterior, que comparaba texto plano directo desde el cliente con la
// clave anónima de Supabase.

const bcrypt = require('bcryptjs');
const { signSession } = require('./_auth');
const { claveServicio, cabecerasServicio } = require('./_supabase');

// Auditoría de los 20 endpoints: no había ningún límite de intentos —
// alguien podía probar contraseñas para un email sin ningún freno.
// record_login_attempt()/clear_login_attempts() (sql/login-attempts-table.sql)
// hacen el conteo en Postgres, no acá, por 3 hallazgos reales de Greptile
// sobre la primera versión (SELECT + INSERT desde el código):
// - Lockout dirigido: el límite era solo por email — cualquiera podía
//   tirar 5 contraseñas mal para el mail de OTRA persona y dejarla afuera
//   repetible. La clave ahora es (email, ip): un ataque desde una IP no
//   bloquea a la dueña de la cuenta entrando desde la suya.
// - Carrera: dos pedidos en simultáneo podían leer "todavía no llegué a 5"
//   los dos antes de que ninguno hubiera guardado el suyo. La función
//   inserta y cuenta en una sola sentencia — no hay ventana entre leer y
//   guardar.
// - Un INSERT fallido quedaba silencioso y ese intento no contaba. Acá se
//   revisa la respuesta de la función y, si no se pudo correr, se corta el
//   login (falla cerrado) en vez de dejar pasar sin ningún freno — login
//   ya depende del mismo Supabase para leer `users`, así que fallar acá
//   tampoco resigna disponibilidad que no se hubiera perdido igual un paso
//   después.
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

function clientIp(req) {
  // Vercel arma x-forwarded-for como "cliente, proxy1, proxy2...".
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || 'sin-ip';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = claveServicio();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }

  const dbHeaders = {
    ...cabecerasServicio(),
    'Content-Type': 'application/json',
  };
  const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...dbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(args),
  });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }
    // emailNorm sirve para contar intentos y para buscar al usuario, sin
    // distinguir mayúsculas: a Carla le fallaba el login por escribir su email
    // distinto de como está guardado ("Majulcarlaa@gmail.com"). Hay emails
    // guardados con mayúsculas de mitad de palabra, así que la búsqueda es
    // ilike (no `eq.`, que sí las distingue) y abajo se elige la fila exacta.
    const emailNorm = String(email).trim().toLowerCase();
    const ip = clientIp(req);

    // Reserva este intento y cuenta cuántos hay para (emailNorm, ip) en la
    // ventana, ANTES de tocar `users` o comparar nada — así un intento que
    // termina resultando exitoso también reserva su lugar (y lo libera abajo
    // con clear_login_attempts), sin la ventana entre "leer" y "guardar" que
    // tenía la versión anterior.
    const attemptResp = await rpc('record_login_attempt', { p_email: emailNorm, p_ip: ip, p_window_minutes: WINDOW_MINUTES });
    if (!attemptResp.ok) {
      console.error('login: record_login_attempt falló', await attemptResp.text());
      return res.status(500).json({ error: 'No se pudo procesar el login, intentá de nuevo' });
    }
    const [{ recent_count } = {}] = await attemptResp.json();
    if (recent_count > MAX_ATTEMPTS) {
      return res.status(429).json({ error: `Demasiados intentos. Esperá ${WINDOW_MINUTES} minutos e intentá de nuevo.` });
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(emailNorm)}&select=*&limit=10`,
      { headers: dbHeaders }
    );
    if (!resp.ok) {
      console.error('login: supabase query failed', await resp.text());
      return res.status(500).json({ error: 'Error consultando usuarios' });
    }

    const rows = await resp.json();
    // ilike trata `_` y `%` como comodines: se descartan las filas que no son
    // el mismo email. Si hubiera dos que difieren solo en mayúsculas, gana la
    // escrita igual que la mandaron.
    const user = rows.find(r => r.email === email)
      || rows.find(r => String(r.email).toLowerCase() === emailNorm);

    // Mismo mensaje de error si el usuario no existe o si la contraseña no
    // matchea, para no revelar qué emails están registrados. El intento ya
    // quedó contado por record_login_attempt de arriba — nada más que hacer
    // acá salvo responder.
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Login exitoso: se libera el contador de este (email, ip) — best-effort,
    // no hace fallar un login que ya es válido si esto no se pudo guardar.
    const clearResp = await rpc('clear_login_attempts', { p_email: emailNorm, p_ip: ip }).catch(() => null);
    if (!clearResp || !clearResp.ok) {
      console.error('login: clear_login_attempts falló (no bloquea el login)');
    }

    const { password: _omit, ...safeUser } = user;
    const token = signSession(safeUser);
    return res.status(200).json({ ...safeUser, token });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: e.message });
  }
};
