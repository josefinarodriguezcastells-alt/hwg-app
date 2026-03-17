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

    const get = (f) => Array.isArray(f) ? (f[0] || '') : String(f || '');

    const notes    = get(fields.notes);
    const lang     = get(fields.lang) || 'es';
    const position = get(fields.position);
    const jd       = get(fields.jd);
    const isEs     = lang === 'es';

    // ── Read CV ──────────────────────────────────────────────────────────────
    let cvText = '';
    const file = files.cv?.[0] || files.cv;

    if (file) {
      const filePath = file.filepath;
      const ext = path.extname(file.originalFilename || '').toLowerCase();

      if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(fs.readFileSync(filePath));
          cvText = pdfData.text;
        } catch(e) {
          cvText = `[PDF no legible: ${file.originalFilename}]`;
        }
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          cvText = result.value;
        } catch(e) {
          cvText = fs.readFileSync(filePath, 'utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
        }
      } else {
        cvText = fs.readFileSync(filePath, 'utf8');
      }
    }

    // ── Read interview/notes file ─────────────────────────────────────────────
    let interviewText = '';
    const interviewFile = files.interview?.[0] || files.interview;
    if (interviewFile) {
      const iPath = interviewFile.filepath;
      const iExt = path.extname(interviewFile.originalFilename || '').toLowerCase();
      try {
        if (iExt === '.pdf') {
          const pdfParse = require('pdf-parse');
          interviewText = (await pdfParse(fs.readFileSync(iPath))).text || '';
        } else if (iExt === '.docx' || iExt === '.doc') {
          const mammoth = require('mammoth');
          interviewText = (await mammoth.extractRawText({ path: iPath })).value || '';
        } else {
          interviewText = fs.readFileSync(iPath, 'utf8');
        }
      } catch(e) { interviewText = ''; }
    }

    if (!cvText || cvText.trim().length < 30) {
      return res.status(400).json({ error: 'No se pudo leer el CV. Probá con otro formato.' });
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `Sos un recruiter senior de HWG Talent Consultants. Tu trabajo es evaluar con HONESTIDAD y criterio riguroso si un candidato es apto para una posición.

IMPORTANTE: NO sos un vendedor. Tu evaluación tiene que ser objetiva y útil para el cliente que va a tomar la decisión de entrevistar o no. Si el candidato no tiene experiencia en el área requerida, decilo claramente. Si hay un cambio de carrera o gaps importantes, son el dato más valioso.

${position ? `POSICIÓN: ${position}` : ''}
${jd ? `\nJOB DESCRIPTION:\n---\n${jd.slice(0, 3000)}\n---` : ''}

CV DEL CANDIDATO:
---
${cvText.slice(0, 6000)}
---
${interviewText ? `\nNOTAS / TRANSCRIPCIÓN DE ENTREVISTA:\n---\n${interviewText.slice(0, 3000)}\n---` : ''}
${notes ? `\nNOTAS DEL RECRUITER:\n---\n${notes}\n---` : ''}

INSTRUCCIONES:
- techFit: número HONESTO del 1 al 10. Si el candidato no tiene experiencia técnica relevante para la posición puede ser 2 o 3.
- tools: SOLO las herramientas que el candidato realmente usa según su CV. Si no usa herramientas de AI y la posición las requiere, no las inventes.
- why: análisis honesto de 5 a 10 líneas. Si hay un cambio de área o falta experiencia técnica, mencionalo. Si hay aspectos transferibles valiosos, destacalos. No exageres el fit.
- gap: análisis claro de los gaps entre el perfil y los requisitos de la posición. Si el candidato no tiene experiencia en el área core, ese es el gap principal. Máximo 3 puntos concretos.
- Si algo no está en el CV usá [COMPLETAR].
- ${isEs ? 'Toda la respuesta en español.' : 'Everything in English.'}

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{"name":"string","role":"string","location":"string","modality":"string","personal":{"linkedin":"string","phone":"string","email":"string","salary":"string","availability":"string"},"snapshot":{"techFit":"string","exp":"string","cult":"string","lang":"string","avail":"string","salary":"string"},"tools":[{"tool":"string","years":"string","level":"string"}],"why":"string","gap":"string"}`;

    // ── Call Claude ───────────────────────────────────────────────────────────
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    res.status(200).json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
