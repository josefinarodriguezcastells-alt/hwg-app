// api/scorecard-prefill.js
// Recibe CV del candidato + preguntas del template
// Devuelve respuestas pre-completadas por Claude

import { requireRole } from './_auth.js';
import { construirPrompt, limpiarPrefill, MAX_TOKENS_RESPUESTA } from './_scorecardPrompt.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Solo el ATS (owner o recruiter con sesión) puede usar este endpoint:
  // cuesta créditos de IA de HWG por uso, y antes cualquiera con la URL lo
  // podía llamar. El ATS manda la sesión desde hwg_ats#55.
  if (!requireRole(req, res, ['owner', 'recruiter'])) return;

  try {
    const { cvBase64, cvMediaType, candidateName, positionRole, positionClient, preguntas, transcripcion, jdEstructurada } = req.body;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

    // El armado del pedido (qué se le manda a la IA y con qué topes) está en
    // _scorecardPrompt.js, donde se puede probar sin llamar a la IA.
    const { system: systemPrompt, userText, recortado } = construirPrompt({
      candidateName, positionRole, positionClient, preguntas, transcripcion, jdEstructurada, tieneCV: !!(cvBase64 && cvMediaType),
    });

    const userContent = [{ type: 'text', text: userText }];

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
        max_tokens: MAX_TOKENS_RESPUESTA,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Error de API' });

    if (data.stop_reason === 'max_tokens') return res.status(500).json({ error: 'La respuesta de la IA quedó cortada. Probá de nuevo.' });
    const raw = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: 'La IA devolvió una respuesta que no se pudo leer. Probá de nuevo.' }); }

    return res.status(200).json({ ok: true, prefill: limpiarPrefill(parsed, preguntas), notasRecortadas: recortado });
  } catch (err) {
    console.error('scorecard-prefill error:', err);
    return res.status(500).json({ error: err.message });
  }
}
