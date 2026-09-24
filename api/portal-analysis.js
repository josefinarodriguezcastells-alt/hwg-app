// api/portal-analysis.js
// "✨ Generar análisis" del portal de clientes (ClientPortal.jsx). El
// cliente entra con PIN y no tiene sesión del ATS; se identifica con su
// portal_token, igual que en portal-presentations.js.
//
// Antes el portal armaba el prompt en el navegador y lo mandaba a
// /api/analyze: con un link de portal real se podía mandar cualquier
// prompt. Acá el navegador solo manda { portal_token, position_id }. El
// servidor resuelve el cliente, verifica que la posición sea suya y esté
// visible en el portal, calcula los datos, arma el prompt, llama a la IA
// con modelo y largo fijos, y guarda positions.ai_analysis.

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECHAZADOS = ['rechazado_salario', 'rechazado_tech', 'rechazado_location', 'rechazado'];
const SIN_MOTIVO = 'Sin motivo registrado';

// Mismo criterio que isPositionVisible/isCandidateVisible de ClientPortal:
// la posición necesita su fila de visibilidad (candidate_id null) sin
// visible=false; cada candidato se ve salvo que tenga su propia fila con
// visible=false.
function posicionVisible(vis) {
  return vis.some(v => v.candidate_id === null && v.visible !== false);
}
function candidatoVisible(vis, candId) {
  const candVis = vis.find(v => v.candidate_id === candId);
  return candVis ? candVis.visible : true;
}

// Los mismos números que ClientPortal calcula en la vista de la posición.
// El portal nunca carga applications.notes (tiene comentarios internos del
// recruiter), así que ahí el motivo sale siempre de rejection_motivo; acá
// tampoco se lee notes.
function resumenPosicion(pos, apps, vis, now = Date.now()) {
  const visibles = apps.filter(a => candidatoVisible(vis, a.candidate_id));
  const rechazados = visibles.filter(a => RECHAZADOS.includes(a.status));
  const activos = visibles.filter(a => a.status !== 'hired' && !RECHAZADOS.includes(a.status));
  const motivoMap = {};
  rechazados.forEach(a => {
    let m = a.rejection_motivo || SIN_MOTIVO;
    if (typeof m === 'object') m = m.motivo || m.label || SIN_MOTIVO;
    motivoMap[m] = (motivoMap[m] || 0) + 1;
  });
  return {
    role: pos.role,
    diasAbierta: pos.opened_at ? Math.floor((now - new Date(pos.opened_at)) / 86400000) : null,
    activos: activos.length,
    rechazados: rechazados.length,
    motivoMap,
    requisitosExcluyentes: pos.jd_structured?.requisitos_excluyentes || null,
    salaryBand: pos.salary_band || null,
  };
}

// Texto idéntico al que armaba generarAnalisisPos en ClientPortal.jsx.
function armarPrompt(r) {
  const motivosStr = Object.entries(r.motivoMap).sort((a, b) => b[1] - a[1]).map(([m, c]) => `- ${m}: ${c}`).join('\n') || 'Sin rechazos registrados';
  return `Sos un recruiter senior de HWG Talent Consultants, escribiéndole directamente al cliente (hiring manager) sobre el estado de esta búsqueda.

POSICIÓN: ${r.role}
DÍAS ABIERTA: ${r.diasAbierta ?? 'recién abierta'}
CANDIDATOS ACTIVOS EN PROCESO: ${r.activos}
TOTAL RECHAZADOS: ${r.rechazados}
MOTIVOS DE RECHAZO (de más a menos frecuente):
${motivosStr}
${r.requisitosExcluyentes ? `REQUISITOS EXCLUYENTES DE LA BÚSQUEDA: ${r.requisitosExcluyentes}` : ''}
${r.salaryBand ? `RANGO SALARIAL OFRECIDO: ${r.salaryBand}` : ''}

Escribí un mensaje corto (3-4 líneas máximo) para el cliente sobre esta búsqueda. Es un mensaje constructivo, no un diagnóstico de problemas — arrancá directo por la propuesta o el próximo paso, no por explicar qué está frenando el cierre. Usá los motivos de rechazo reales de arriba para fundamentar la propuesta (sin citarlos como una lista de fallas), y si corresponde sugerí un ajuste concreto (salario, requisitos, timing). Cerrá invitando a decidir juntos el próximo paso, no dejándolo como un veredicto cerrado. Nunca uses frases negativas o categóricas (nada de "no existe", "no vamos a poder", "el problema es"). Sé un socio que ya tiene una idea de cómo destrabarlo, no alguien que viene a explicar por qué algo no funcionó.

Respondé solo el texto del mensaje, sin encabezados.`;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { portal_token, position_id } = req.body || {};
  if (!portal_token || !position_id) return res.status(400).json({ error: 'Faltan datos (portal_token, position_id)' });
  // position_id va a una URL armada a mano: se valida como UUID antes de
  // usarlo (mismo motivo que en portal-presentations.js).
  if (typeof position_id !== 'string' || !UUID_RE.test(position_id)) return res.status(400).json({ error: 'position_id inválido' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  const baseHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  const get = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: baseHeaders });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || `Supabase ${r.status}`);
    return data;
  };

  try {
    const clients = await get(`clients?portal_token=eq.${encodeURIComponent(portal_token)}&portal_active=eq.true&select=id`);
    const client = Array.isArray(clients) ? clients[0] : null;
    if (!client) return res.status(403).json({ error: 'Portal inválido' });

    // Filtrar por client_id en la misma consulta: una posición de otro
    // cliente da lo mismo que una que no existe.
    const [positions, vis, apps] = await Promise.all([
      get(`positions?id=eq.${position_id}&client_id=eq.${client.id}&select=id,role,opened_at,salary_band,jd_structured`),
      get(`client_portal_visibility?client_id=eq.${client.id}&position_id=eq.${position_id}&select=candidate_id,visible`),
      get(`applications?position_id=eq.${position_id}&select=candidate_id,status,rejection_motivo`),
    ]);
    const pos = positions[0];
    if (!pos || !posicionVisible(vis)) return res.status(404).json({ error: 'Posición no encontrada' });

    const prompt = armarPrompt(resumenPosicion(pos, apps, vis));
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
    const aiData = await aiResp.json();
    if (!aiResp.ok) throw new Error(aiData.error?.message || 'Claude error');
    const texto = (aiData.content || []).map(c => c.text || '').join('').trim();
    if (!texto) return res.status(502).json({ error: 'La IA no devolvió texto' });

    const now = new Date().toISOString();
    const saveResp = await fetch(`${SUPABASE_URL}/rest/v1/positions?id=eq.${pos.id}&client_id=eq.${client.id}`, {
      method: 'PATCH',
      headers: { ...baseHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ai_analysis: texto, ai_analysis_updated_at: now }),
    });
    if (!saveResp.ok) {
      console.error('portal-analysis: no se pudo guardar', saveResp.status, await saveResp.text());
      return res.status(500).json({ error: 'No se pudo guardar el análisis' });
    }

    return res.status(200).json({ ai_analysis: texto, ai_analysis_updated_at: now });
  } catch (e) {
    console.error('portal-analysis error:', e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = handler;
module.exports.resumenPosicion = resumenPosicion;
module.exports.armarPrompt = armarPrompt;
