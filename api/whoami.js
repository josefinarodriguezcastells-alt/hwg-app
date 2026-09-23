// api/whoami.js
// Valida el JWT de sesión interna del ATS (mismo mecanismo que owner-data.js)
// y devuelve quién es — usado por el portal de clientes para que el owner,
// si ya está logueado en el ATS en el mismo navegador, no tenga que
// tipear el PIN de cada cliente por separado.
//
// Solo confirma identidad, no expone nada sensible: mismo id/email/role
// que ya viaja adentro del JWT.

const { requireRole } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner']);
  if (!session) return; // requireRole ya mandó 401/403

  return res.status(200).json({ id: session.id, email: session.email, role: session.role });
};
