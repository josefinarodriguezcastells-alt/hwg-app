const formidable = require('formidable');
const fs = require('fs');
const path = require('path');

// ─── CONFIGURACIÓN DE PROVEEDOR ───────────────────────────────────────────────
// Para cambiar de proveedor: modificá solo esta variable.
// Opciones: 'gemini' (gratis hasta 1500 req/día) | 'claude' | 'openai'
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';

async function callAI(prompt) {
  if (AI_PROVIDER === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini error');
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (AI_PROVIDER === 'claude') {
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
    if (!response.ok) throw new Error(data.error?.message || 'Claude error');
    return (data.content || []).map(c => c.text || '').join('');
  }

  if (AI_PROVIDER === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
    return data.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Proveedor desconocido: ${AI_PROVIDER}`);
}
// ─────────────────────────────────────────────────────────────────────────────

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

    const raw = await callAI(prompt);
    const clean = raw.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(clean);
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
