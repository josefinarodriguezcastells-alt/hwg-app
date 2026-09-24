const formidable = require('formidable');
const fs = require('fs');
const path = require('path');
const { extractPdfText } = require('./_pdf-text');
const { requireRole } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Paso 1 de 3 para cerrar este endpoint (no usa IA, pero procesa archivos
  // en el servidor de HWG y no pedía nada): si viene sesión del ATS se
  // valida; si no viene, todavía se deja pasar porque el ATS en producción
  // aún no la manda.
  // Cuando el ATS que la manda esté deployado, pasa a exigirse siempre.
  if (req.headers.authorization && !requireRole(req, res, ['owner', 'recruiter'])) return;

  try {
    const form = new formidable.IncomingForm({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'No file provided' });

    const ext = path.extname(file.originalFilename || '').toLowerCase();
    const buffer = fs.readFileSync(file.filepath);

    let text = '';

    if (ext === '.pdf') {
      text = await extractPdfText(buffer);
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } else if (ext === '.doc') {
      // .doc legacy: return error asking for docx/pdf
      return res.status(400).json({ error: 'Formato .doc no soportado. Convertí a .docx o PDF.' });
    } else {
      // Try as plain text
      text = buffer.toString('utf-8');
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return res.status(200).json({ text });

  } catch (err) {
    console.error('extract-text error:', err);
    return res.status(500).json({ error: err.message });
  }
};
