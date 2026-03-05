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
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const notes = fields.notes?.[0] || fields.notes || '';
    const lang = fields.lang?.[0] || fields.lang || 'es';
    const isEs = lang === 'es';

    // Read file content
    let cvText = '';
    const file = files.cv?.[0] || files.cv;
    
    if (file) {
      const filePath = file.filepath;
      const fileName = file.originalFilename || '';
      const ext = path.extname(fileName).toLowerCase();
      
      if (ext === '.pdf') {
        // Use pdf-parse for PDFs
        try {
          const pdfParse = require('pdf-parse');
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdfParse(dataBuffer);
          cvText = pdfData.text;
        } catch(e) {
          cvText = `[PDF: ${fileName} - no se pudo extraer texto]`;
        }
      } else if (ext === '.docx' || ext === '.doc') {
        // Use mammoth for Word docs
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          cvText = result.value;
        } catch(e) {
          cvText = fs.readFileSync(filePath, 'utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
        }
      } else {
        // Plain text
        cvText = fs.readFileSync(filePath, 'utf8');
      }
    }

    if (!cvText || cvText.trim().length < 50) {
      return res.status(400).json({ error: 'No se pudo leer el contenido del CV. Intentá con otro formato.' });
    }

    const prompt = `Sos un recruiter senior de HWG Talent Consultants. Analizá el siguiente CV y extraé la información para completar una presentación de candidato.

CV:
---
${cvText.slice(0, 8000)}
---
${notes.trim() ? `\nNOTAS ADICIONALES:\n---\n${notes}\n---` : ''}

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{"name":"string","role":"string","location":"string","modality":"string","personal":{"linkedin":"string","phone":"string","email":"string"},"snapshot":{"techFit":"string","exp":"string","cult":"string","lang":"string","avail":"[COMPLETAR]","salary":"[COMPLETAR]"},"tools":[{"tool":"string","years":"string","level":"string"}],"why":"string"}

REGLAS: tools entre 4 y 6 items. Si algo no está en el CV usá [COMPLETAR]. Para personal.linkedin, personal.phone y personal.email: extraelos del CV si están, si no usá [COMPLETAR]. ${isEs ? 'Todo en español.' : 'Everything in English.'} Solo JSON, nada más.\`

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
    res.status(500).json({ error: e.message });
  }
};
