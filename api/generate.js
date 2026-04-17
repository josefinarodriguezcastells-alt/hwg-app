const formidable = require('formidable');
const fs = require('fs');
const path = require('path');

// ─── CONFIGURACIÓN DE PROVEEDOR ───────────────────────────────────────────────
// Para cambiar de proveedor: modificá solo esta variable.
// Opciones: 'gemini' (gratis hasta 1500 req/día) | 'claude' | 'openai'
const AI_PROVIDER = process.env.AI_PROVIDER || 'claude';

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
          generationConfig: { temperature: 0.3 }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini error');
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return raw.replace(/```json|```/g, '').trim();
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
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    console.log('Claude response status:', response.status);
    console.log('Claude response keys:', Object.keys(data));
    console.log('Claude content blocks:', JSON.stringify((data.content || []).map(c => ({type: c.type, len: (c.text||'').length}))));
    if (data.error) console.log('Claude error:', JSON.stringify(data.error));
    if (!response.ok) throw new Error(data.error?.message || 'Claude error');
    const textBlocks = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '');
    const joined = textBlocks.join('').replace(/```json|```/g, '').trim();
    const jsonMatch = joined.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : joined;
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
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');
    return (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
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
    const form = new formidable.IncomingForm({ maxFileSize: 5 * 1024 * 1024, multiples: true });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const get = (f) => Array.isArray(f) ? (f[0] || '') : String(f || '');

    const notes             = get(fields.notes);
    const interviewerNotes  = get(fields.interviewer_notes);
    const salary            = get(fields.salary);
    const availability      = get(fields.availability);
    const lang              = get(fields.lang) || 'es';
    const position          = get(fields.position);
    const jd                = get(fields.jd);
    const jdNotes           = get(fields.jd_notes);
    const candidateNotes    = get(fields.candidate_notes);
    const scorecardText     = get(fields.scorecard);
    const cvUrl             = get(fields.cv_url);
    const isEs              = lang === 'es';

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

    const extractTextFromUrl = async (url) => {
      if (!url) return '';
      try {
        const response = await fetch(url);
        if (!response.ok) return '';
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = url.split('?')[0].split('.').pop().toLowerCase();
        if (ext === 'pdf') {
          const pdfParse = require('pdf-parse');
          return (await pdfParse(buffer)).text || '';
        } else if (ext === 'docx' || ext === 'doc') {
          const mammoth = require('mammoth');
          return (await mammoth.extractRawText({ buffer })).value || '';
        } else {
          return buffer.toString('utf8');
        }
      } catch(e) { return ''; }
    };

    let cvText = '';
    if (cvUrl) {
      cvText = await extractTextFromUrl(cvUrl);
    } else {
      const cvFile = files.cv?.[0] || files.cv;
      cvText = await extractText(cvFile);
    }

    if (!cvText || cvText.trim().length < 30) {
      return res.status(400).json({ error: 'No se pudo leer el CV. Probá con otro formato.' });
    }

    const interviewSections = [];
    const otherSections = [];

    const interviewFile = files.interview?.[0] || files.interview;
    if (interviewFile) {
      const t = await extractText(interviewFile);
      if (t) interviewSections.push(t.slice(0, 3000));
    }

    let i = 0;
    while (files[`extra_${i}`]) {
      const f = files[`extra_${i}`]?.[0] || files[`extra_${i}`];
      const label = get(fields[`extra_${i}_label`]) || `Documento adicional ${i + 1}`;
      const t = await extractText(f);
      if (t) {
        if (label.toLowerCase().includes('interview') || label.toLowerCase().includes('entrevista') || label.toLowerCase().includes('notas')) {
          interviewSections.push(t.slice(0, 3000));
        } else {
          otherSections.push(`${label.toUpperCase()}:\n${t.slice(0, 1500)}`);
        }
      }
      i++;
    }

    // Fusionar notas del box + archivos de notas como una sola fuente principal
    const recruiterNoteParts = [
      interviewerNotes ? `NOTAS DEL RECRUITER (box de texto):\n${interviewerNotes}` : '',
      ...interviewSections.map((s, idx) => `NOTAS DE ENTREVISTA (archivo ${idx + 1}):\n${s}`),
    ].filter(Boolean);

    const allInterviewNotes = [
      recruiterNoteParts.length > 0 ? recruiterNoteParts.join('\n\n') : '',
      candidateNotes ? `NOTAS GENERALES DEL CANDIDATO:\n${candidateNotes}` : '',
      notes          ? `CONTEXTO ADICIONAL:\n${notes}`                    : '',
      scorecardText  ? `SCORECARD:\n${scorecardText}`                     : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const hasInterviewNotes = allInterviewNotes.trim().length > 5;

    const logisticBlock = [
      salary       ? `SALARIO PRETENDIDO: ${salary}`   : '',
      availability ? `DISPONIBILIDAD: ${availability}` : '',
    ].filter(Boolean).join('\n');
    const otherDocsBlock = otherSections.length ? `\nDOCUMENTOS ADICIONALES:\n${otherSections.join('\n---\n')}\n` : '';

    const prompt = `Sos un recruiter senior con más de 10 años de experiencia trabajando con empresas y candidatos de todo el mundo, en industrias que van desde tecnología, finanzas, salud, consumo masivo, industria, educación, retail, medios, logística y cualquier otro sector. Trabajás con posiciones de todos los niveles, desde junior hasta C-level, y con perfiles técnicos y no técnicos por igual.

Cuando leés un CV y las notas de una entrevista, no describís lo que está escrito — interpretás lo que significa. Sabés leer entre líneas: entendés qué dice una trayectoria sobre cómo trabaja alguien, qué revelan sus motivaciones reales sobre su fit cultural, y qué gaps son salvables y cuáles no. Tu análisis le habla directamente al hiring manager: no le resumís el CV, le explicás por qué este candidato específico tiene o no sentido para este rol específico, en esta empresa específica, en este momento particular.

Preparás una presentación profesional para un cliente de HWG Talent Consultants. El cliente va a leer MUCHOS reportes. Si todos suenan igual, perdemos credibilidad. Cada reporte tiene que reflejar a ESA persona específica, con sus palabras, su historia, sus motivaciones reales.

FUENTES DE INFORMACIÓN (en orden de importancia):
${hasInterviewNotes ? `
1. NOTAS DE ENTREVISTA — FUENTE PRINCIPAL. Todo el análisis parte de acá. Usá lo que el candidato dijo en sus propias palabras. El storytelling tiene que reflejar la entrevista, no el CV. Si hay scorecard, incorporá esas evaluaciones al análisis.
---
${allInterviewNotes.slice(0, 6000)}
---` : `
1. NOTAS DE ENTREVISTA — NO HAY. El reporte debe basarse solo en el CV. Aclaralo al inicio del storytelling: "Nota: este perfil fue generado sin entrevista previa."
`}

2. CV DEL CANDIDATO — para historial, herramientas y trayectoria:
---
${cvText.slice(0, 5000)}
---
${otherDocsBlock}
${jd ? `3. JOB DESCRIPTION — criterio principal de evaluación. Usá esto para determinar el fit técnico y los gaps:
---
${jd.slice(0, 2500)}
---` : '3. JOB DESCRIPTION — NO HAY. Evaluá en base al rol y la industria mencionados.'}

${jdNotes ? `4. CONTEXTO ADICIONAL DE LA POSICIÓN — igual o más importante que la JD. Cultura del cliente, requisitos no escritos, lo que dijo el hiring manager, el perfil real que buscan más allá del papel:
---
${jdNotes.slice(0, 2000)}
---` : ''}

${position ? `POSICIÓN: ${position}` : ''}

${logisticBlock ? `DATOS LOGÍSTICOS DEL CANDIDATO (ya confirmados con él):
${logisticBlock}` : ''}

INSTRUCCIONES CRÍTICAS:

FIT TÉCNICO — calculá el puntaje del 1 al 10 sumando estos 4 criterios contra la JD (o el rol si no hay JD):
  • expRol (0-3): experiencia directa haciendo lo que pide este rol. 0 = sin experiencia relevante, 1 = tangencial, 2 = parcial, 3 = directa y sólida.
  • stack (0-3): dominio de las herramientas, tecnologías o metodologías que requiere la posición. 0 = no las tiene, 1 = algunas, 2 = la mayoría, 3 = todas o casi todas.
  • seniority (0-2): nivel de la persona vs lo que pide la posición. 0 = muy lejos (ej: junior para un rol senior o viceversa), 1 = cerca pero no exacto, 2 = coincide.
  • logros (0-2): tiene logros medibles y relevantes para este rol específico. 0 = no hay logros relevantes, 1 = algunos logros aplicables, 2 = logros sólidos y directamente relevantes.
  El techFit total es la suma: expRol + stack + seniority + logros.

- recommendation: basate en el techFit total:
  * "Recomendado/a para entrevistar" → techFit ≥ 7 Y gaps menores o salvables
  * "Perfil a evaluar con cautela" → techFit entre 5 y 6, o gaps importantes pero salvables
  * "No recomendado/a para esta posición" → techFit ≤ 4, o gaps estructurales que no se pueden superar

- tools: SOLO herramientas que aparecen explícitamente en el CV o las notas. Cero invenciones. Para cada tool: "tool" es el nombre, "years" solo si el CV menciona explícitamente los años — si no está claro, dejá years como string vacío "".
- experience: los 4 trabajos más recientes del CV, de más reciente a más antiguo.
- englishLevel: nivel real según CV o lo mencionado en entrevista. Si no se sabe: "No especificado".
- personal.salary: usá exactamente el valor de SALARIO PRETENDIDO si viene en los datos logísticos. Si no hay, extraelo del CV o notas.
- personal.availability: usá exactamente el valor de DISPONIBILIDAD si viene en los datos logísticos. Si no hay, extraelo de las notas.
- snapshot.exp: síntesis de la experiencia total en 4-6 palabras. Ej: "8 años en finanzas corporativas", "5 años en desarrollo backend".
- storytelling: 4 a 6 líneas que solo pueden aplicar a ESTA persona. Si hay notas de entrevista, usá frases o conceptos que el candidato mencionó. Escribís como un recruiter que realmente conoce al candidato y entiende el negocio del cliente. PROHIBIDO usar frases genéricas como "sólida trayectoria", "perfil versátil", "orientado a resultados", "gran potencial", "excelente comunicador". Si el perfil no es bueno para el rol, decilo con claridad y sin vueltas — el hiring manager lo agradece más que el suavizado.
- gap: 2 a 3 gaps REALES y ESPECÍFICOS entre este candidato y esta posición. No inventes gaps pero tampoco los suavices. Sé directo: el hiring manager necesita saber qué le falta, no que "podría mejorar en algunas áreas".
- ${isEs ? 'Toda la respuesta en español.' : 'Everything in English.'}

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin bloques de código), con esta estructura exacta:
{"name":"string","role":"string","location":"string","modality":"string","personal":{"linkedin":"string","phone":"string","email":"string","salary":"string","availability":"string","company":"string"},"snapshot":{"techFit":"string","exp":"string","cult":"string","englishLevel":"string"},"fitCriteria":{"expRol":0,"stack":0,"seniority":0,"logros":0},"tools":[{"tool":"string","years":"string"}],"experience":[{"role":"string","company":"string","period":"string"}],"storytelling":"string","gap":[{"title":"string","detail":"string"}],"recommendation":"string"}`;

    // ── Llamada al proveedor de IA ──
    const raw = await callAI(prompt);

    if (!raw || raw.trim().length === 0) {
      return res.status(500).json({ error: 'La IA devolvió una respuesta vacía. Intentá de nuevo.' });
    }

    // ── Validar que el JSON sea parseable antes de devolver ──
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      console.error('JSON parse error. Raw length:', raw.length, 'First 500 chars:', raw.slice(0, 500));
      return res.status(500).json({ error: 'La IA devolvió una respuesta inválida. Intentá de nuevo.' });
    }

    res.status(200).json({
      content: [{ type: 'text', text: JSON.stringify(parsed) }]
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
