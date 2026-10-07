// api/finanzas-pin.js
// PIN del módulo Finanzas. Antes estaba escrito en el código del frontend
// (cualquiera que mirara el bundle lo veía) y solo tapaba la pantalla. Ahora
// vive hasheado en app_settings (sin acceso anónimo), se valida acá con
// límite de intentos, y devuelve un token de 12 horas que owner-data exige
// para leer o tocar las tablas de Finanzas.
//
//   POST { pin }                    -> { ok, token }
//   PUT  { pin, nuevo }             -> { ok }   (cambiar el PIN; pide el actual)
//
// Solo owner (la sesión del ATS va en Authorization, como en el resto).

const bcrypt = require('bcryptjs');
const { requireRole, signFinanzas } = require('./_auth');
const { claveServicio, cabecerasServicio } = require('./_supabase');

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const KEY = 'finanzas_pin_hash';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || 'sin-ip';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner']);
  if (!session) return;

  const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY = claveServicio();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  const headers = { ...cabecerasServicio(), 'Content-Type': 'application/json' };
  const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(args) });

  try {
    const { pin, nuevo } = req.body || {};
    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'PIN inválido' });

    // Límite de intentos por usuario + IP (mismo mecanismo que api/login.js).
    const attemptKey = `finanzas:${session.id}`;
    const ip = clientIp(req);
    const attemptResp = await rpc('record_login_attempt', { p_email: attemptKey, p_ip: ip, p_window_minutes: WINDOW_MINUTES });
    if (!attemptResp.ok) {
      console.error('finanzas-pin: record_login_attempt falló', await attemptResp.text());
      return res.status(500).json({ error: 'No se pudo validar el PIN, intentá de nuevo' });
    }
    const [{ recent_count } = {}] = await attemptResp.json();
    if (recent_count > MAX_ATTEMPTS) return res.status(429).json({ error: `Demasiados intentos. Esperá ${WINDOW_MINUTES} minutos e intentá de nuevo.` });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${KEY}&select=value`, { headers });
    if (!r.ok) return res.status(500).json({ error: 'No se pudo leer la configuración' });
    const rows = await r.json();
    if (!rows[0] || !rows[0].value) return res.status(500).json({ error: 'El PIN de Finanzas no está configurado' });

    const ok = await bcrypt.compare(pin, rows[0].value);
    if (!ok) return res.status(403).json({ error: 'PIN incorrecto' });
    await rpc('clear_login_attempts', { p_email: attemptKey, p_ip: ip }).catch(() => null);

    if (req.method === 'POST') return res.status(200).json({ ok: true, token: signFinanzas(session) });

    // PUT: cambiar el PIN
    if (typeof nuevo !== 'string' || !/^\d{4,8}$/.test(nuevo)) return res.status(400).json({ error: 'El PIN nuevo tiene que tener entre 4 y 8 números' });
    const hash = await bcrypt.hash(nuevo, 10);
    const up = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${KEY}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ value: hash, updated_at: new Date().toISOString(), updated_by: session.email || session.id }),
    });
    if (!up.ok) return res.status(500).json({ error: 'No se pudo guardar el PIN nuevo' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('finanzas-pin error:', e);
    return res.status(500).json({ error: 'Error validando el PIN' });
  }
};
