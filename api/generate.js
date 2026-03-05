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

    const notesRaw = fields.notes;
    const notes = Array.isArray(notesRaw) ? (notesRaw[0] || '') : String(notesRaw || '');
    const langRaw = fields.lang;
    const lang = Array.isArray(langRaw) ? (langRaw[0] || 'es') : String(langRaw || 'es');
    const positionRaw = fields.position;
    const position = Array.isArray(positionRaw) ? (positionRaw[0] || '') : String(positionRaw || '');
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

    // Read interview file if provided
    let interviewText = '';
    const interviewRaw = files.interview;
    const interviewFile = Array.isArray(interviewRaw) ? interviewRaw[0] : interviewRaw;
    if (interviewFile) {
      const iPath = interviewFile.filepath;
      const iExt = path.extname(interviewFile.originalFilename || '').toLowerCase();
      try {
        if (iExt === '.pdf') {
          const pdfParse = require('pdf-parse');
          const parsed = await pdfParse(fs.readFileSync(iPath));
          interviewText = parsed.text || '';
        } else if (iExt === '.docx' || iExt === '.doc') {
          const mammoth = require('mammoth');
          interviewText = (await mammoth.extractRawText({ path: iPath })).value || '';
        } else {
          interviewText = fs.readFileSync(iPath, 'utf8');
        }
      } catch(e) { interviewText = ''; }
    }

    if (!cvText || cvText.trim().length < 50) {
      return res.status(400).json({ error: 'No se pudo leer el contenido del CV. Intentá con otro formato.' });
    }

    const positionBlock = position.trim()
      ? `\nPOSICIÓN OBJETIVO: ${position.trim()}\nIMPORTANTE: Toda la presentación debe estar orientada a esta posición. Destacá las skills, experiencia y logros más relevantes para este rol específico. El fit técnico, culture fit, tools y el resumen final deben reflejar por qué este candidato es ideal para ESTA posición.\n`
      : '';

    const prompt = `Sos un recruiter senior de HWG Talent Consultants. Analizá el siguiente CV y generá una presentación de candidato.
${positionBlock}
CV:
---
${cvText.slice(0, 6000)}
---
${interviewText.trim() ? `\nENTREVISTA:\n---\n${interviewText.slice(0, 3000)}\n---` : ''}
${notes.trim() ? `\nNOTAS ADICIONALES:\n---\n${notes}\n---` : ''}

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{"name":"string","role":"string","location":"string","modality":"string","personal":{"linkedin":"string","phone":"string","email":"string"},"snapshot":{"techFit":"string","exp":"string","cult":"string","lang":"string","avail":"[COMPLETAR]","salary":"[COMPLETAR]"},"tools":[{"tool":"string","years":"string","level":"string"}],"why":"string"}

REGLAS: tools entre 4 y 6 items priorizando las más relevantes para la posición. Si algo no está en el CV ni en la entrevista usá [COMPLETAR]. Para personal.linkedin, personal.phone y personal.email: extraelos del CV si están, si no usá [COMPLETAR]. Si hay entrevista, priorizá disponibilidad y pretensión salarial de ahí. ${isEs ? 'Todo en español.' : 'Everything in English.'} Solo JSON, nada más.`;

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
