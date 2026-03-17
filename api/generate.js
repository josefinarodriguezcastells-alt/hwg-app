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
    const form = new formidable.IncomingForm({ maxFileSize: 20 * 1024 * 1024, multiples: true });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const get = (f) => Array.isArray(f) ? (f[0] || '') : String(f || '');

    const notes           = get(fields.notes);
    const lang            = get(fields.lang) || 'es';
    const position        = get(fields.position);
    const jd              = get(fields.jd);
    const candidateNotes  = get(fields.candidate_notes); // notas generales del candidato
    const isEs            = lang === 'es';

    // ── Helper: extract text from a file ─────────────────────────────────────
    const extractText = async (file) => {
      if (!file) return '';
      const filePath = file.filepath;
      const ext = path.extname(file.originalFilename || '').toLowerCase();
      try {
        if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          return (await pdfParse(fs.readFileSync(filePath))).text || '';
        } else if (ext === '.docx' || ext === '.doc') {
          const mammoth = require('mammoth');
          return (await mammoth.extractRawText({ path: filePath })).value || '';
        } else {
          return fs.readFileSync(filePath, 'utf8');
        }
      } catch(e) { return `[No se pudo leer: ${file.originalFilename}]`; }
    };

    // ── Read CV ───────────────────────────────────────────────────────────────
    const cvFile = files.cv?.[0] || files.cv;
    const cvText = await extractText(cvFile);

    if (!cvText || cvText.trim().length < 30) {
      return res.status(400).json({ error: 'No se pudo leer el CV. Probá con otro formato.' });
    }

    // ── Read additional docs (interview, extra_0, extra_1, ...) ──────────────
    const extraSections = [];

    // Legacy single interview file
    const interviewFile = files.interview?.[0] || files.interview;
    if (interviewFile) {
      const t = await extractText(interviewFile);
      if (t) extraSections.push(`NOTAS DE ENTREVISTA:\n${t.slice(0, 3000)}`);
    }

    // Multiple extra docs sent as extra_0, extra_1, extra_2...
    let i = 0;
    while (files[`extra_${i}`]) {
      const f = files[`extra_${i}`]?.[0] || files[`extra_${i}`];
      const label = get(fields[`extra_${i}_label`]) || `Documento adicional ${i + 1}`;
      const t = await extractText(f);
      if (t) extraSections.push(`${label.toUpperCase()}:\n${t.slice(0, 2000)}`);
      i++;
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const extraBlock = extraSections.length
      ? `\n${extraSections.join('\n---\n')}\n`
      : '';

    const prompt = `Sos un recruiter senior de HWG Talent Consultants. Tu trabajo es evaluar con HONESTIDAD y criterio riguroso si un candidato es apto para una posición.

IMPORTANTE: NO sos un vendedor. Tu evaluación tiene que ser objetiva y útil para el cliente que va a tomar la decisión de entrevistar o no. Si el candidato no tiene experiencia en el área requerida, decilo claramente. Si hay un cambio de carrera o gaps importantes, son el dato más valioso.

${position ? `POSICIÓN: ${position}` : ''}
${jd ? `\nJOB DESCRIPTION:\n---\n${jd.slice(0, 3000)}\n---` : ''}

CV DEL CANDIDATO:
---
${cvText.slice(0, 6000)}
---
${extraBlock}
${candidateNotes ? `NOTAS GENERALES DEL CANDIDATO (contexto del recruiter):\n---\n${candidateNotes.slice(0, 1500)}\n---\n` : ''}
${notes ? `NOTAS DE PRESENTACIÓN (salario, disponibilidad, contexto adicional):\n---\n${notes}\n---` : ''}

INSTRUCCIONES:
- techFit: número HONESTO del 1 al 10.
- tools: SOLO herramientas que el candidato realmente usa según su CV. No inventes.
- experience: array con la trayectoria laboral real del candidato extraída del CV. Máximo 4 entradas, ordenadas de más reciente a más antigua. Cada entrada: role, company, period (ej: "2019 — 2023 · 4 años").
- englishLevel: nivel de inglés real según CV. Si no se menciona: "No especificado". Valores posibles: "Nativo", "Avanzado (C1/C2)", "Intermedio (B1/B2)", "Básico (A1/A2)", "No especificado", "No requerido para el rol".
- storytelling: análisis honesto de 4 a 6 líneas. Si hay cambio de área o falta técnica, mencionalo. No exageres el fit.
- gap: array de exactamente 2 a 3 objetos. Cada uno: {"title":"string corto","detail":"string explicativo"}. Gaps reales y concretos entre el perfil y la posición.
- recommendation: "Recomendado/a para entrevistar" | "Perfil a evaluar con cautela" | "No recomendado/a para esta posición". Sé honesto.
- Si algo no está en el CV usá [COMPLETAR].
- ${isEs ? 'Toda la respuesta en español.' : 'Everything in English.'}

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{"name":"string","role":"string","location":"string","modality":"string","personal":{"linkedin":"string","phone":"string","email":"string","salary":"string","availability":"string"},"snapshot":{"techFit":"string","exp":"string","cult":"string","englishLevel":"string"},"tools":[{"tool":"string","years":"string","level":"string"}],"experience":[{"role":"string","company":"string","period":"string"}],"storytelling":"string","gap":[{"title":"string","detail":"string"}],"recommendation":"string"}`;

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
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    res.status(200).json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
