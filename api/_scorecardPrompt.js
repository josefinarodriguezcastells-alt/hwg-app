// Armado del pedido a la IA para pre-completar el scorecard.
// Vive aparte del endpoint (api/scorecard-prefill.js) para poder probarlo sin
// llamar a la IA. Underscore = helper compartido, no es un endpoint.
//
// Criterio de costo: las notas se leen COMPLETAS hasta un tope duro
// (antes se cortaban en 6.000 caracteres y se perdía el final de la entrevista).
// 30.000 caracteres son unas 8.000 palabras: una entrevista larga entra entera.

const MAX_NOTAS = 30000;
// Datos fijos del scorecard (no son preguntas del template) que también pueden quedar en "no se habló".
const CAMPOS_FIJOS = ['sueldo', 'motivo_cambio', 'vacaciones', 'otros_procesos'];
const MAX_CRITERIOS = 12;
const MAX_CALIBRACIONES = 6;
const MAX_TOKENS_RESPUESTA = 3000;

const PILLS = [
  'startup', 'scaleup', 'corpo', 'agencia', 'consultora', 'move_fast', 'iterativo', 'procesos_largos', 'waterfall',
  'autonomia', 'consenso', 'verticalista', 'agil', 'ownership', 'ejecutor', 'generalista', 'especialista',
  'hands_on', 'estrategico', 'remoto_first', 'presencial', 'hibrido', 'async_first', 'reunion_heavy',
  'feedback_directo', 'jerarquico', 'flat', 'data_driven', 'people_first',
];

// Corta las notas al tope y avisa si hubo corte. Si hay que cortar, se queda
// con el principio y el final: lo último que se habló (cierre, sueldo,
// disponibilidad) suele ser lo más útil y antes se perdía siempre.
function recortarNotas(texto, max = MAX_NOTAS) {
  const t = String(texto || '').trim();
  if (t.length <= max) return { texto: t, recortado: false };
  const mitad = Math.floor(max / 2);
  return {
    texto: t.slice(0, mitad) + '\n[... parte del medio omitida por largo ...]\n' + t.slice(t.length - mitad),
    recortado: true,
  };
}

// La JD estructurada aporta lo que la posición realmente pide, para que la IA
// calcule "años relevantes" y resuma el CV mirando lo que importa. Tope fijo.
function resumirCriterios(jdEstructurada) {
  const j = jdEstructurada && typeof jdEstructurada === 'object' ? jdEstructurada : {};
  const criterios = (Array.isArray(j.criterios) ? j.criterios : [])
    .filter(c => c && typeof c.texto === 'string' && c.texto.trim())
    .slice(0, MAX_CRITERIOS)
    .map(c => `- ${c.texto.trim().slice(0, 200)} (${c.tipo === 'excluyente' ? 'excluyente' : 'deseable'}, importancia ${['alta', 'media', 'baja'].includes(c.importancia) ? c.importancia : 'media'})`);
  const calibraciones = (Array.isArray(j.calibraciones) ? j.calibraciones : [])
    .map(c => (typeof c === 'string' ? c : c?.texto || ''))
    .filter(c => c.trim())
    .slice(0, MAX_CALIBRACIONES)
    .map(c => `- ${c.trim().slice(0, 200)}`);
  return { criterios, calibraciones };
}

function construirPrompt({ candidateName, positionRole, positionClient, preguntas, transcripcion, jdEstructurada, tieneCV = true }) {
  const lista = (preguntas || []).map((p, i) =>
    `${i + 1}. [${p.id}] ${p.label} (tipo: ${p.tipo}${p.opciones ? ', opciones: ' + p.opciones.join('/') : ''})`
  ).join('\n');

  const { texto: notas, recortado } = recortarNotas(transcripcion);
  const tieneNotas = !!notas;
  const { criterios, calibraciones } = resumirCriterios(jdEstructurada);

  const system = `Sos un asistente de recruiting. Tu tarea es analizar la información disponible de un candidato y pre-completar un scorecard de entrevista.

${tieneNotas
  ? 'FUENTE PRINCIPAL: las notas/transcripción de la entrevista — reflejá lo que el candidato realmente dijo, no solo lo que figura en el CV. El CV es contexto de trayectoria; la entrevista es la fuente de verdad sobre esta persona hoy. Si las notas y el CV se contradicen, ganan las notas.'
  : 'No hay entrevista todavía — completá en base al CV únicamente, y para las preguntas que dependen de haber hablado con el candidato (impresión personal, comunicación, etc.) no respondas.'}

REGLA DE ORO: nunca inventes. Si algo no se habló en las notas ni surge del CV, NO lo respondas: dejá la respuesta vacía y poné el id de la pregunta en "no_se_hablo". Lo mismo vale para los datos fijos: si no se habló del sueldo, del motivo del cambio, de las vacaciones o de otros procesos, dejalos vacíos y poné "sueldo", "motivo_cambio", "vacaciones" u "otros_procesos" en "no_se_hablo". Es mejor un campo vacío que uno inventado.

Devolvé ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "nombre_apellido": "string — nombre completo del candidato",
  "anios_experiencia": "string — años de experiencia RELEVANTES para el puesto, calculados con las fechas del CV (no estimados a ojo), con el cálculo corto entre paréntesis. Ej: '6 años en Data Engineering (2019–2025)'. Vacío si no hay fechas.",
  "pretension_salarial": "string — solo si se dijo en las notas o está en el CV, con monto y moneda tal cual. Sino ''",
  "sueldo": { "monto": "número entero sin puntos ni símbolos, o null si no se dijo (si dijo un rango, el monto más alto)", "moneda": "USD o ARS (pesos), o '' si no queda claro", "periodo": "mensual o hora, o '' si no queda claro" },
  "motivo_cambio": "string — por qué busca cambiar de trabajo, con sus palabras y breve. Vacío si no se habló.",
  "vacaciones": "string — vacaciones ya agendadas o viajes planeados que afecten la fecha de inicio. Vacío si no se habló.",
  "otros_procesos": "\"si\" si dijo que tiene otros procesos de selección abiertos, \"no\" si dijo que no tiene, \"\" si no se habló",
  "fit_cultural_pills": ["ids de pills culturales que mejor describen al candidato, solo si hay base real"],
  "respuestas": {
    "[id_pregunta]": "valor pre-completado según el tipo de pregunta"
  },
  "no_se_hablo": ["ids de las preguntas del scorecard que NO se pudieron responder con la información disponible"],
  "notas_cv": "string — resumen de 2-3 líneas de los puntos del CV más relevantes para ESTA posición. ${tieneCV ? '' : 'NO HAY CV adjunto: devolvé \"\" y no menciones que falta el CV.'}"
}

Para las respuestas:
- tipo "si_no": "si" o "no"; si no hay base, no la incluyas
- tipo "escala": número del 1 al 5 como string; si no hay base, no la incluyas
- tipo "texto": texto breve basado en lo que se dijo; si no hay base, NO la incluyas (nunca escribas frases como "no se abordó" o "sin información": dejala afuera y listala en no_se_hablo)
- tipo "opciones": una de las opciones disponibles; si no hay base, no la incluyas

Para fit_cultural_pills usá solo estos ids: ${PILLS.join(', ')}

No incluyas explicaciones, solo el JSON.`;

  const partes = [`Candidato: ${candidateName || ''}\nPosición: ${positionRole || ''}${positionClient ? ' en ' + positionClient : ''}`];
  if (criterios.length) {
    partes.push(`LO QUE PIDE LA POSICIÓN (para decidir qué es relevante):\n${criterios.join('\n')}`);
  }
  if (calibraciones.length) {
    partes.push(`AJUSTES RECIENTES DE LA BÚSQUEDA:\n${calibraciones.join('\n')}`);
  }
  if (tieneNotas) {
    partes.push(`NOTAS / TRANSCRIPCIÓN DE LA ENTREVISTA${recortado ? ' (muy larga: se muestran el principio y el final)' : ''}:\n---\n${notas}\n---`);
  }
  partes.push(`Preguntas del scorecard:\n${lista || '(este scorecard no tiene preguntas adicionales)'}`);
  partes.push(`Analizá toda la información disponible (${tieneNotas ? 'entrevista y CV adjunto' : 'CV adjunto'}) y pre-completá el scorecard.`);

  return { system, userText: partes.join('\n\n'), recortado };
}

// La IA a veces devuelve cosas fuera de lo pedido. Se deja solo lo que el
// scorecard sabe usar: respuestas de preguntas que existen, con valores válidos.
// A veces la IA escribe "No se abordó en detalle..." como respuesta en vez de
// dejarla vacía. Eso no es una respuesta: cuenta como "no se habló".
// El resumen del CV viaja al informe: una frase sobre un CV que no existe no debe llegar ahí.
const SIN_CV = /^\s*(no hay (un )?cv|sin cv|no (se )?(adjunt|cuenta con|dispone|proporcion)|el cv no)/i;
const RELLENO = /^\s*(no se (abord|habl|detall|mencion|dijo|profundiz|especific|brind|indic|sabe)|no (hay|consta|figura|surge|se registra)\s+(informaci[oó]n|datos?|evidencia|detalles?|menci[oó]n|referencias?)\b|sin (detalles?|informaci[oó]n|datos|evidencia|mencion)|no (fue|fueron) (abordad|mencionad|detallad))/i;


// Si la IA no devolvió el sueldo en partes pero sí como texto ("3.200 USD mensuales",
// "$4,1M brutos", "15.000 - 16.000 USD"), se convierte acá con reglas fijas, sin IA.
// Si hay un rango se toma el monto más alto. Lo dudoso (moneda, período) queda vacío.
function parsearSueldoTexto(texto) {
  const t = String(texto || '').toLowerCase();
  const montos = [];
  for (const m of t.matchAll(/(\d[\d.,]*)\s*(millones?|mill\b|mm?\b|mil\b|k\b)?/g)) {
    const crudo = m[1].replace(/[.,]+$/, '');
    const suf = m[2] || '';
    let n;
    if (/^m|^mill/.test(suf)) n = parseFloat(crudo.replace(',', '.')) * 1e6;
    else if (/^(mil|k)/.test(suf)) n = parseFloat(crudo.replace(',', '.')) * 1e3;
    else if (/^\d{1,3}([.,]\d{3})+$/.test(crudo)) n = Number(crudo.replace(/[.,]/g, ''));
    else if (/^\d+[.,]\d{1,2}$/.test(crudo)) n = Math.round(parseFloat(crudo.replace(',', '.')));
    else n = Number(crudo);
    if (Number.isFinite(n) && n > 0) montos.push(Math.round(n));
  }
  if (!montos.length) return null;
  const usd = /usd|u\$s|us\$|d[oó]lar/.test(t);
  const ars = !usd && (/\$|ars|peso/.test(t));
  const hora = /por hora|\/\s*h\b|la hora|\bhora\b/.test(t);
  const mensual = !hora && /mensual|por mes|al mes|\/\s*mes|\bmes\b/.test(t);
  return { monto: String(Math.max(...montos)), moneda: usd ? 'USD' : ars ? 'ARS' : '', periodo: hora ? 'hora' : mensual ? 'mensual' : '' };
}

function limpiarPrefill(parsed, preguntas) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const porId = Object.fromEntries((preguntas || []).map(q => [q.id, q]));
  const respuestas = {};
  const relleno = [];
  for (const [id, v] of Object.entries(p.respuestas && typeof p.respuestas === 'object' ? p.respuestas : {})) {
    const q = porId[id];
    if (!q || typeof v !== 'string' || !v.trim()) continue;
    if (RELLENO.test(v)) { relleno.push(id); continue; }
    if (q.tipo === 'escala' && !/^[1-5]$/.test(v.trim())) continue;
    if (q.tipo === 'si_no' && !['si', 'sí', 'no'].includes(v.trim().toLowerCase())) continue;
    if (q.tipo === 'opciones' && !(q.opciones || []).includes(v.trim())) continue;
    respuestas[id] = v.trim();
  }
  const str = x => (typeof x === 'string' ? x.trim() : '');
  const sd = p.sueldo && typeof p.sueldo === 'object' ? p.sueldo : {};
  const monto = Number(String(sd.monto ?? '').replace(/[^0-9]/g, ''));
  const moneda = String(sd.moneda || '').toUpperCase();
  const periodo = String(sd.periodo || '').toLowerCase();
  const sueldoIA = Number.isFinite(monto) && monto > 0
    ? { monto: String(monto), moneda: ['USD', 'ARS'].includes(moneda) ? moneda : '', periodo: ['mensual', 'hora'].includes(periodo) ? periodo : '' }
    : null;
  // Respaldo: si la IA solo dio el texto, se convierte con reglas fijas.
  const sueldo = sueldoIA || parsearSueldoTexto(str(p.pretension_salarial));
  const motivo = RELLENO.test(str(p.motivo_cambio)) ? '' : str(p.motivo_cambio);
  const vacaciones = RELLENO.test(str(p.vacaciones)) ? '' : str(p.vacaciones);
  const otros = ['si', 'sí', 'no'].includes(str(p.otros_procesos).toLowerCase()) ? (str(p.otros_procesos).toLowerCase() === 'no' ? 'no' : 'si') : '';
  const fijosVacios = { sueldo: !sueldo, motivo_cambio: !motivo, vacaciones: !vacaciones, otros_procesos: !otros };
  // Un dato fijo que quedó vacío es, por definición, algo que no se habló.
  const noSeHablo = [
    ...[...(Array.isArray(p.no_se_hablo) ? p.no_se_hablo : []), ...relleno].filter(id => porId[id] && !respuestas[id]),
    ...CAMPOS_FIJOS.filter(id => fijosVacios[id]),
  ];
  return {
    nombre_apellido: str(p.nombre_apellido),
    anios_experiencia: str(p.anios_experiencia),
    pretension_salarial: str(p.pretension_salarial),
    sueldo,
    motivo_cambio: motivo,
    vacaciones,
    otros_procesos: otros,
    fit_cultural_pills: (Array.isArray(p.fit_cultural_pills) ? p.fit_cultural_pills : []).filter(x => PILLS.includes(x)),
    respuestas,
    no_se_hablo: [...new Set(noSeHablo)],
    notas_cv: SIN_CV.test(str(p.notas_cv)) || RELLENO.test(str(p.notas_cv)) ? '' : str(p.notas_cv),
  };
}

module.exports = { parsearSueldoTexto, MAX_NOTAS, MAX_TOKENS_RESPUESTA, PILLS, recortarNotas, resumirCriterios, construirPrompt, limpiarPrefill };
