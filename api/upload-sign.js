// api/upload-sign.js
// Entrega un permiso de subida de un solo uso para el bucket 'candidates'
// (CVs, cartas, certificados y notas de entrevista). Así el navegador sube el
// archivo con ese permiso y el bucket no necesita aceptar subidas anónimas.
//
//   POST { path }  →  { path, token }   (el cliente sigue con uploadToSignedUrl)
//
// Solo owner y recruiter, y solo paths con la forma que usa el ATS: no se
// puede pedir permiso para escribir en cualquier lugar del bucket.

const { requireRole } = require('./_auth');

const BUCKET = 'candidates';
const EXT = '[A-Za-z0-9]{1,10}';
const PATHS_VALIDOS = [
  new RegExp(`^cvs/\\d{10,14}\\.${EXT}$`),                                                            // CV al crear un candidato
  new RegExp(`^[0-9A-Za-z-]{8,40}/(cv|cover_letter|certificate|interview_notes)_\\d{10,14}\\.${EXT}$`), // documentos de un candidato
];
const pathValido = (p) => typeof p === 'string' && p.length <= 120 && PATHS_VALIDOS.some(r => r.test(p));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = requireRole(req, res, ['owner', 'recruiter']);
  if (!session) return;

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });

  const path = req.body && req.body.path;
  if (!pathValido(path)) return res.status(400).json({ error: 'Ruta de archivo no permitida' });

  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json || !json.url) return res.status(502).json({ error: (json && (json.message || json.error)) || 'No se pudo preparar la subida' });
    const token = new URL(json.url, 'http://x').searchParams.get('token');
    if (!token) return res.status(502).json({ error: 'Respuesta inesperada de Storage' });
    return res.status(200).json({ path, token });
  } catch (e) {
    console.error('upload-sign error:', e);
    return res.status(502).json({ error: 'No se pudo preparar la subida' });
  }
};
module.exports.pathValido = pathValido;
