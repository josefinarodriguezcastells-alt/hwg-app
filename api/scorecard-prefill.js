// api/scorecard-prefill.js
// Recibe CV del candidato + preguntas del template
// Devuelve respuestas pre-completadas por Claude

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { cvBase64, cvMediaType, candidateName, positionRole, positionClient, preguntas, transcripcion } = req.body;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

    // Armar lista de preguntas para el prompt
    const preguntasStr = (preguntas || []).map((p, i) =>
      `${i + 1}. [${p.id}] ${p.label} (tipo: ${p.tipo}${p.opciones ? ', opciones: ' + p.opciones.join('/') : ''})`
    ).join('\n');

    const tieneTranscripcion = !!(transcripcion && transcripcion.trim());

    const systemPrompt = `Sos un asistente de recruiting. Tu tarea es analizar la información disponible de un candidato y pre-completar un scorecard de entrevista.

${tieneTranscripcion
  ? 'FUENTE PRINCIPAL: la transcripción/notas de la entrevista — reflejá lo que el candidato realmente dijo y cómo se desempeñó, no solo lo que figura en el CV. El CV es contexto de trayectoria; la entrevista es la fuente de verdad sobre esta persona hoy.'
  : 'No hay entrevista todavía — completá en base al CV únicamente, y para las preguntas que dependen de haber hablado con el candidato (impresión personal, comunicación, etc.) dejá la respuesta vacía en vez de inventar.'}

Devolvé ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "nombre_apellido": "string — nombre completo del candidato",
  "anios_experiencia": "string — años de experiencia relevante para el puesto, estimado desde el CV. Ej: '7 años en Data Engineering'",
  "pretension_salarial": "string — si está en el CV, sino ''",
  "fit_cultural_pills": ["array de strings — ids de pills culturales que mejor describen al candidato basado en su historia laboral"],
  "respuestas": {
    "[id_pregunta]": "valor pre-completado según el tipo de pregunta"
  },
  "notas_cv": "string — resumen breve de 2-3 líneas de los puntos más relevantes del CV para esta posición"
}

Para las respuestas:
- tipo "si_no": responde "si", "no" o "" si no podés determinarlo
- tipo "escala": responde número del 1 al 5 como string, o "" si no podés determinarlo  
- tipo "texto": responde con texto basado en la entrevista (si hay) o el CV, o "" si no aplica
- tipo "opciones": responde con una de las opciones disponibles, o "" si no podés determinarlo

Para fit_cultural_pills, usá solo estos ids si aplican:
startup, scaleup, corpo, agencia, consultora, move_fast, iterativo, procesos_largos, waterfall,
autonomia, consenso, verticalista, agil, ownership, ejecutor, generalista, especialista,
hands_on, estrategico, remoto_first, presencial, hibrido, async_first, reunion_heavy,
feedback_directo, jerarquico, flat, data_driven, people_first

No incluyas explicaciones, solo el JSON.`;

    const userContent = [
      {
        type: 'text',
        text: `Candidato: ${candidateName}\nPosición: ${positionRole} en ${positionClient}\n${tieneTranscripcion ? `\nTRANSCRIPCIÓN / NOTAS DE LA ENTREVISTA:\n---\n${transcripcion.slice(0, 6000)}\n---\n` : ''}\nPreguntas del scorecard:\n${preguntasStr}\n\nAnalizá toda la información disponible (${tieneTranscripcion ? 'entrevista y CV adjunto' : 'CV adjunto'}) y pre-completá el scorecard.`
      }
    ];

    // Agregar CV si está disponible
    if (cvBase64 && cvMediaType) {
      userContent.unshift({
        type: 'document',
        source: { type: 'base64', media_type: cvMediaType, data: cvBase64 }
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Error de API' });

    const raw = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    return res.status(200).json({ ok: true, prefill: parsed });
  } catch (err) {
    console.error('scorecard-prefill error:', err);
    return res.status(500).json({ error: err.message });
  }
}
