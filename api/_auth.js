// Helpers de sesión compartidos por los endpoints protegidos.
// El token es un JWT firmado con SESSION_SECRET (nunca expuesto al browser)
// que contiene {id, email, role} tal como están en Supabase al momento del login.

const jwt = require('jsonwebtoken');

function signSession(user) {
  const secret = process.env.SESSION_SECRET;
  // 365 días, no 12hs: el frontend guarda esto en localStorage y nunca lo
  // refresca ni chequea vencimiento — una recruiter que deja la pestaña
  // abierta de un día para el otro (lo normal acá) se quedaba sin sesión
  // válida justo para el endpoint protegido de Finanzas, mientras el
  // resto de la app seguía andando con la clave anónima. Encontrado
  // cuando un hire confirmado no generó la línea de facturación.
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '365d' });
}

// Verifica el JWT y chequea que el rol esté en allowedRoles.
// Si falla, ya manda la respuesta de error y devuelve null — el caller
// debe cortar ejecución (`if (!session) return;`).
function requireRole(req, res, allowedRoles) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'SESSION_SECRET no configurada' });
    return null;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (e) {
    res.status(401).json({ error: 'Sesión inválida o expirada' });
    return null;
  }

  if (!allowedRoles.includes(payload.role)) {
    res.status(403).json({ error: 'No tenés permiso para esto' });
    return null;
  }

  return payload;
}

// Token corto que prueba "esta sesión del owner ya tipeó el PIN de Finanzas".
// Se firma con el mismo secreto pero lleva kind:'finanzas' y el id del owner,
// así no sirve como sesión del ATS ni se puede usar con la sesión de otra
// persona. Dura 12 horas: pasado eso hay que volver a poner el PIN.
function signFinanzas(session) {
  return jwt.sign({ id: session.id, kind: 'finanzas' }, process.env.SESSION_SECRET, { expiresIn: '12h' });
}

// true si el header X-Finanzas-Token es un token de Finanzas válido de ESTA
// sesión. No manda respuesta: el caller decide qué hacer.
function hasFinanzasToken(req, session) {
  const token = req.headers['x-finanzas-token'];
  if (!token || !process.env.SESSION_SECRET) return false;
  try {
    const p = jwt.verify(String(token), process.env.SESSION_SECRET);
    return p.kind === 'finanzas' && p.id === session.id;
  } catch (e) {
    return false;
  }
}

// Sesión corta del portal de clientes: se entrega cuando el PIN es correcto
// (api/portal-verify) y la exige api/portal-db. Lleva solo el id del cliente.
// kind:'portal' la hace inservible como sesión del ATS (requireRole la
// rechaza: no tiene role) y una sesión del ATS no vale como sesión de portal.
function signPortal(clientId) {
  return jwt.sign({ kind: 'portal', cid: clientId }, process.env.SESSION_SECRET, { expiresIn: '12h' });
}
// Devuelve { cid } si el Authorization es una sesión de portal válida; si no, null.
function verifyPortal(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || !process.env.SESSION_SECRET) return null;
  try {
    const p = jwt.verify(token, process.env.SESSION_SECRET);
    return p.kind === 'portal' && typeof p.cid === 'string' && p.cid ? { cid: p.cid } : null;
  } catch (e) {
    return null;
  }
}

module.exports = { signSession, requireRole, signFinanzas, hasFinanzasToken, signPortal, verifyPortal };
