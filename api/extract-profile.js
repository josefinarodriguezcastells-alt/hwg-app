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
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = files.cv?.[0] || files.cv;
    if (!file) return res.status(400).json({ error: 'No file provided' });

    const filePath = file.filepath;
    const ext = path.extname(file.originalFilename || '').toLowerCase();
    let cvText = '';

    try {
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        cvText = (await pdfParse(fs.readFileSync(filePath))).text || '';
      } else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth');
        cvText = (await mammoth.extractRawText({ path: filePath })).value || '';
      } else {
        cvText = fs.readFileSync(filePath, 'utf8');
      }
    } catch(e) {
      console.log('extract-profile: failed to read file:', e.message);
      return res.status(200).json({ name: null, email: null, phone: null, linkedin_url: null, location: null });
    }

    if (!cvText || cvText.trim().length < 20) {
      console.log('extract-profile: text too short or empty, length:', cvText?.length);
      return res.status(200).json({ name: null, email: null, phone: null, linkedin_url: null, location: null });
    }

    const prompt = `Extraé los datos personales de este CV. Respondé ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.

CV:
---
${cvText.slice(0, 4000)}
---

Reglas estrictas:
- Solo devolvé datos que estén EXPLÍCITAMENTE en el CV. Si no está, devolvé null.
- name: nombre completo de la persona (string o null)
- email: dirección de email (string o null)
- phone: teléfono o celular, tal como aparece en el CV (string o null)
- linkedin_url: URL de LinkedIn sin el https:// (ej: "linkedin.com/in/juanperez") (string o null)
- location: ciudad y país si aparecen (string o null)

Respondé SOLO con este JSON:
{"name":null,"email":null,"phone":null,"linkedin_url":null,"location":null}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(raw);
      return res.status(200).json({
        name:         parsed.name         || null,
        email:        parsed.email        || null,
        phone:        parsed.phone        || null,
        linkedin_url: parsed.linkedin_url || null,
        location:     parsed.location     || null,
      });
    } catch(e) {
      return res.status(200).json({ name: null, email: null, phone: null, linkedin_url: null, location: null });
    }

  } catch(e) {
    console.error('extract-profile error:', e.message);
    return res.status(200).json({ name: null, email: null, phone: null, linkedin_url: null, location: null });
  }
};
