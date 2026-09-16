// Helpers de sesión compartidos por los endpoints protegidos.
// El token es un JWT firmado con SESSION_SECRET (nunca expuesto al browser)
// que contiene {id, email, role} tal como están en Supabase al momento del login.

const jwt = require('jsonwebtoken');

function signSession(user) {
  const secret = process.env.SESSION_SECRET;
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '12h' });
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

module.exports = { signSession, requireRole };
