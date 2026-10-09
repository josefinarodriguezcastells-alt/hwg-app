// api/informe-v2-prueba.js
// Arma el informe nuevo (v2) de una postulación SOLO PARA PROBARLO: lee todo lo que
// hace falta (CV, todas las notas, JD con criterios, scorecard, cultura), llama a la
// IA una vez y devuelve el informe con su chequeo de calidad. No escribe nada en la
// base, no publica y no marca nada como visto. Solo el owner.
//
//   POST { application_id, modelo?: 'haiku' | 'sonnet' | 'opus' }

const { requireRole } = require('./_auth');
const { claveServicio, cabecerasServicio } = require('./_supabase');
const { textoDeUrl } = require('./_docTexto');
const I = require('./_informeV2');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODELOS = { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const MAX_TOKENS_RESPUESTA = 5000;

const ETIQUETAS = {
  startup: 'Startup', scaleup: 'Scale-up', corpo: 'Corporación', agencia: 'Agencia', consultora: 'Consultora',
  move_fast: 'Move fast', iterativo: 'Iterativo', procesos_largos: 'Procesos largos', waterfall: 'Waterfall',
  autonomia: 'Autonomía', consenso: 'Consenso', verticalista: 'Verticalista', agil: 'Ágil',
  ownership: 'Ownership', ejecutor: 'Ejecutor', generalista: 'Generalista', especialista: 'Especialista',
  hands_on: 'Hands-on', estrategico: 'Estratégico',
  remoto_first: 'Remoto-first', presencial: 'Presencial', hibrido: 'Híbrido', async_first: 'Async-first', reunion_heavy: 'Reunión-heavy',
  feedback_directo: 'Feedback directo', jerarquico: 'Jerárquico', flat: 'Flat', data_driven: 'Data-driven', people_first: 'People-first',
};
const comoLista = (v) => { if (Array.isArray(v)) return v; try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };

async function leer(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: cabecerasServicio() });
  if (!r.ok) throw new Error(`No se pudo leer ${path.split('?')[0]} (${r.status})`);
  return r.json();
}

async function llamarIA(modelo, sistema, usuario) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELOS[modelo], max_tokens: MAX_TOKENS_RESPUESTA, temperature: 0.2, system: sistema, messages: [{ role: 'user', content: usuario }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Error de la IA');
  if (data.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA quedó cortada');
  const txt = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  let json;
  try { json = JSON.parse(m ? m[0] : txt); } catch { throw new Error('La IA devolvió una respuesta que no se pudo leer'); }
  return { json, uso: data.usage || {} };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireRole(req, res, ['owner'])) return;

  const { application_id: appId, modelo = 'haiku' } = req.body || {};
  if (!UUID.test(String(appId || ''))) return res.status(400).json({ error: 'application_id inválido' });
  if (!MODELOS[modelo]) return res.status(400).json({ error: 'modelo inválido' });
  if (!process.env.SUPABASE_URL || !claveServicio()) return res.status(500).json({ error: 'Supabase no configurado' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

  try {
    const [app] = await leer(`applications?id=eq.${appId}&select=id,candidate_id,position_id`);
    if (!app) return res.status(404).json({ error: 'Postulación no encontrada' });
    const [cand] = await leer(`candidates?id=eq.${app.candidate_id}&select=*`);
    const [pos] = await leer(`positions?id=eq.${app.position_id}&select=*`);
    const [cliente] = pos?.client_id ? await leer(`clients?id=eq.${pos.client_id}&select=name,cultural_tags,cultural_comment`) : [null];
    const [sc] = await leer(`scorecards?application_id=eq.${appId}&order=created_at.desc&limit=1&select=*`);
    let scorecard = null;
    if (sc) {
      const [tpl] = sc.template_id ? await leer(`scorecard_templates?id=eq.${sc.template_id}&select=preguntas`) : [null];
      scorecard = { ...sc, preguntas: tpl?.preguntas || [] };
    }
    const docs = await leer(`candidate_documents?candidate_id=eq.${app.candidate_id}&type=eq.interview_notes&order=created_at.asc&select=name,url,created_at`);
    const textosNotas = await Promise.all(docs.map(async d => ({
      nombre: d.name, fecha: String(d.created_at || '').slice(0, 10), texto: await textoDeUrl(d.url),
    })));
    const notas = I.juntarNotasCandidato(textosNotas);
    const cvCrudo = await textoDeUrl(cand?.cv_url);
    const cv = I.recortarMedio(cvCrudo, I.MAX_CV).texto;

    const jd = I.criteriosDeJD(pos?.jd_structured);
    const etiquetas = [...new Set([...comoLista(cliente?.cultural_tags), ...comoLista(pos?.cultural_tags)])];
    const etiquetasTxt = etiquetas.map(t => ETIQUETAS[t] || t);
    const culturaTexto = [etiquetasTxt.length ? `Etiquetas: ${etiquetasTxt.join(', ')}` : '', cliente?.cultural_comment ? `Descripción del cliente: ${cliente.cultural_comment}` : ''].filter(Boolean).join('\n');
    const calibraciones = (Array.isArray(pos?.jd_structured?.calibraciones) ? pos.jd_structured.calibraciones : [])
      .map(c => (typeof c === 'string' ? c : c?.texto || '')).filter(Boolean).slice(0, 6);

    const entrada = {
      candidato: { name: cand?.name || '', location: cand?.location || '', linkedin_url: cand?.linkedin_url || '', phone: cand?.phone || '', email: cand?.email || '' },
      posicion: { role: pos?.role || '', cliente: cliente?.name || '', salary_band: pos?.salary_band || '', salary_currency: pos?.salary_currency || '', modality: pos?.modalidad || pos?.modality || '' },
      criterios: jd.criterios, criteriosConfirmados: jd.confirmados, calibraciones,
      jdRespaldo: jd.criterios.length ? '' : String(pos?.jd || '').slice(0, I.MAX_JD_RESPALDO),
      notasTexto: notas.texto, cvTexto: cv,
      scorecardTexto: I.serializarScorecard(scorecard), scorecard,
      cultura: { hay: !!culturaTexto, texto: culturaTexto, etiquetas: etiquetasTxt },
    };
    if (!entrada.cvTexto || entrada.cvTexto.length < 30) return res.status(400).json({ error: 'No se pudo leer el CV del candidato' });

    const { sistema, usuario } = I.construirPrompt(entrada);
    const { json, uso } = await llamarIA(modelo, sistema, usuario);
    const informe = I.ensamblarInforme({ entrada, ia: json, fuentes: { notas: entrada.notasTexto, cv: cvCrudo, scorecard: entrada.scorecardTexto } });

    return res.status(200).json({
      ok: true, informe,
      uso: { modelo: MODELOS[modelo], entrada: uso.input_tokens || 0, salida: uso.output_tokens || 0, costo_usd_aprox: I.costoAprox(modelo, uso.input_tokens || 0, uso.output_tokens || 0) },
      entrada: { documentos_de_notas: notas.cantidad, notas_chars: entrada.notasTexto.length, notas_recortadas: notas.recortado, cv_chars: cv.length, criterios: entrada.criterios.length, origen_criterios: jd.origen, criterios_confirmados: jd.confirmados, scorecard: !!scorecard },
    });
  } catch (e) {
    console.error('informe-v2-prueba error:', e);
    return res.status(500).json({ error: e.message });
  }
};
