const formidable = require('formidable');
const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = new formidable.IncomingForm({ maxFileSize: 10 * 1024 * 1024 });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, f, fi) => {
        if (err) reject(err);
        else resolve([f, fi]);
      });
    });

    // formidable v3 returns arrays — handle both v2 and v3
    const notesRaw = fields.notes;
    const notes = Array.isArray(notesRaw) ? (notesRaw[0] || '') : (String(notesRaw || ''));
    const langRaw = fields.lang;
    const lang = Array.isArray(langRaw) ? (langRaw[0] || 'es') : (String(langRaw || 'es'));
    const isEs = lang === 'es';

    // Read file
    let cvText = '';
    const fileRaw = files.cv;
    const file = Array.isArray(fileRaw) ? fileRaw[0] : fileRaw;

    if (file) {
      const filePath = file.filepath;
      const fileName = file.originalFilename || '';
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const buf = fs.readFileSync(filePath);
          const parsed = await pdfParse(buf);
          cvText = parsed.text || '';
        } catch (e) {
          cvText = '';
        }
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          cvText = result.value || '';
        } catch (e) {
          try { cvText = fs.readFileSync(filePath, 'utf8'); } catch(e2) { cvText = ''; }
        }
      } else {
        try { cvText = fs.readFileSync(filePath, 'utf8'); } catch(e) { cvText = ''; }
      }
    }

    if (!cvText || cvText.trim().length < 30) {
      return res.status(400).json({ error: 'No se pudo leer el CV. Intentá con otro formato.' });
    }

    const notesBlock = notes.trim().length > 0
      ? '\nNOTAS DEL RECRUITER:\n---\n' + notes.trim() + '\n---'
      : '';

    const lang_instruction = isEs ? 'Todo en español.' : 'Everything in English.';

    const prompt = 'Sos un recruiter senior de HWG Talent Consultants. Analizá el siguiente CV y extraé la información.\n\nCV:\n---\n' + cvText.slice(0, 8000) + '\n---\n' + notesBlock + '\n\nRespondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:\n{"name":"string","role":"string","location":"string","modality":"string","snapshot":{"techFit":"string","exp":"string","cult":"string","lang":"string","avail":"[COMPLETAR]","salary":"[COMPLETAR]"},"tools":[{"tool":"string","years":"string","level":"string"}],"why":"string"}\n\nREGLAS: tools entre 4 y 6 items. Si algo no está en el CV usá [COMPLETAR]. ' + lang_instruction + ' Solo JSON, nada más.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    res.status(200).json(data);

  } catch (e) {
    res.status(500).json({ error: e.message || 'Error interno' });
  }
};
