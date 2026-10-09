// Motor del informe nuevo (versión 2). Todo lo que NO necesita IA vive acá y se
// prueba sin llamarla: armado del pedido, verificación de citas, ranking,
// sueldo contra la banda, encabezado, recomendación y chequeo de calidad.
// La IA solo juzga y escribe; las cuentas y las comprobaciones las hace el código.
//
// El informe v2 incluye también los campos del formato anterior (name, personal,
// snapshot, tools, experience, storytelling, gap, recommendation, fitCultural,
// analisis) para que la página del cliente, el editor, el PDF, el mail y el
// portal sigan mostrándolo mientras se actualizan una por una.

const { montosDeTexto } = require('./_scorecardPrompt');

const MAX_NOTAS = 30000;
const MAX_CV = 10000;
const MAX_JD_RESPALDO = 6000;
const MAX_CRITERIOS = 12;
const MAX_STORYTELLING = 1000;
const PESOS = { alta: 3, media: 2, baja: 1 };
const VALOR = { cumple: 1, parcial: 0.5, no: 0 };
const VEREDICTOS = ['cumple', 'parcial', 'no', 'sin_dato'];

const REC = {
  si: 'Recomendado/a para entrevistar',
  cautela: 'Perfil a evaluar con cautela',
  no: 'No recomendado/a para esta posición',
  sinDatos: 'Sin información suficiente para evaluar',
};

// ── Texto ────────────────────────────────────────────────────────────────────
const normalizar = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[“”«»"']/g, ' ')
  .replace(/[^a-z0-9ñ$%.,/+#-]+/g, ' ')
  .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const palabras = (s) => normalizar(s).split(' ').filter(Boolean);

// ¿La cita existe de verdad en el texto? Primero exacta (sin mayúsculas, tildes ni
// espacios de más). Si no, tolera cambios chicos: busca una ventana del texto que
// contenga casi todas las palabras de la cita en el mismo orden.
function citaExiste(cita, texto) {
  const c = normalizar(cita);
  if (c.length < 8) return false;
  const t = normalizar(texto);
  if (t.includes(c)) return true;
  const pc = c.split(' ');
  if (pc.length < 4) return false;
  const pt = t.split(' ');
  const ventana = Math.ceil(pc.length * 1.6);
  const idx = new Map();
  pt.forEach((w, i) => { if (!idx.has(w)) idx.set(w, []); idx.get(w).push(i); });
  const inicios = idx.get(pc[0]) || idx.get(pc[1]) || [];
  for (const ini of inicios) {
    let pos = ini - 1, hallados = 0;
    for (const w of pc) {
      let j = pos + 1;
      const tope = Math.min(pt.length, ini + ventana);
      while (j < tope && pt[j] !== w) j++;
      if (j < tope) { hallados++; pos = j; }
    }
    if (hallados / pc.length >= 0.9) return true;
  }
  return false;
}

// Recorta dejando principio y final (lo último que se habló suele ser lo útil).
function recortarMedio(texto, max) {
  const t = String(texto || '').trim();
  if (t.length <= max) return { texto: t, recortado: false };
  const m = Math.floor(max / 2);
  return { texto: t.slice(0, m) + '\n[... parte del medio omitida por largo ...]\n' + t.slice(t.length - m), recortado: true };
}

// Varias notas del mismo candidato: se leen todas, de la más vieja a la más nueva.
// Si no entran, se descartan primero las más viejas (lo último que dijo manda).
function juntarNotasCandidato(docs, max = MAX_NOTAS) {
  // El mismo texto subido dos veces cuenta una sola vez (se queda la copia más nueva).
  const vistos = new Set();
  const unicos = [];
  for (const d of [...(docs || [])].reverse()) {
    const t = String(d?.texto || '').trim();
    if (!t) continue;
    const clave = normalizar(t).slice(0, 4000) + '|' + t.length;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.unshift(d);
  }
  const bloques = unicos.map(d => `[NOTAS subidas el ${d.fecha || 's/f'} — ${d.nombre || 'archivo'}]\n${String(d.texto).trim()}`);
  const elegidos = [];
  let largo = 0, recortado = false;
  for (let i = bloques.length - 1; i >= 0; i--) {
    const resto = max - largo;
    if (bloques[i].length > resto) {
      recortado = true;
      // No se descarta una nota entera por unos caracteres: entra lo que cabe
      // (principio y final) si queda lugar suficiente.
      if (resto >= 2000 || elegidos.length === 0) elegidos.unshift(recortarMedio(bloques[i], Math.max(200, resto - 100)).texto);
      break;
    }
    elegidos.unshift(bloques[i]);
    largo += bloques[i].length + 2;
  }
  return { texto: elegidos.join('\n\n'), recortado, cantidad: bloques.length, duplicadas: (docs || []).filter(d => String(d?.texto || '').trim()).length - unicos.length };
}

// ── Criterios de la JD ───────────────────────────────────────────────────────
// Usa los criterios confirmados de la JD estructurada. Si la posición todavía no
// los tiene (hoy casi ninguna), arma unos de respaldo con los requisitos de
// siempre y lo avisa: el ranking usa criterios estándar, sin confirmar.
function criteriosDeJD(jd) {
  const j = jd && typeof jd === 'object' ? jd : {};
  const dados = (Array.isArray(j.criterios) ? j.criterios : [])
    .filter(c => c && typeof c.texto === 'string' && c.texto.trim());
  if (dados.length) {
    return {
      confirmados: !!j._confirmado,
      origen: 'criterios',
      criterios: dados.slice(0, MAX_CRITERIOS).map(c => ({
        texto: c.texto.trim().slice(0, 300),
        tipo: c.tipo === 'excluyente' ? 'excluyente' : 'deseable',
        importancia: PESOS[c.importancia] ? c.importancia : 'media',
      })),
    };
  }
  const frases = (txt) => String(txt || '').split(/\n|\.\s+|;\s+/).map(x => x.replace(/^[-•*\d.)\s]+/, '').trim()).filter(x => x.length >= 3);
  const respaldo = [
    ...frases(j.requisitos_excluyentes).map(texto => ({ texto: texto.slice(0, 300), tipo: 'excluyente', importancia: 'media' })),
    ...frases(j.requisitos_deseables).map(texto => ({ texto: texto.slice(0, 300), tipo: 'deseable', importancia: 'baja' })),
  ].slice(0, MAX_CRITERIOS);
  return { confirmados: false, origen: respaldo.length ? 'requisitos' : 'ninguno', criterios: respaldo };
}

// ── Banda de sueldo ──────────────────────────────────────────────────────────
function parsearBanda(texto, moneda) {
  const montos = montosDeTexto(texto).filter(n => n >= 100);
  if (!montos.length) return null;
  return { min: Math.min(...montos), max: Math.max(...montos), moneda: moneda === 'ARS' || moneda === 'USD' ? moneda : '' };
}

// 'arriba' (supera el tope), 'abajo' (bajo el piso), 'dentro', o null si no se puede
// comparar (falta algo o la moneda/período no coinciden). Nunca bloquea nada.
function compararConBanda(sueldo, banda) {
  if (!sueldo || !sueldo.monto || !banda) return null;
  if (!sueldo.moneda || !banda.moneda || sueldo.moneda !== banda.moneda) return null;
  if (sueldo.periodo === 'hora') return null;
  const m = Number(sueldo.monto);
  if (!Number.isFinite(m)) return null;
  if (m > banda.max) return 'arriba';
  if (m < banda.min) return 'abajo';
  return 'dentro';
}

// ── Ranking ──────────────────────────────────────────────────────────────────
function calcularRanking(criterios) {
  let suma = 0, pesos = 0, evaluados = 0, sinDato = 0;
  const excluyentesFallidos = [];
  for (const c of criterios) {
    if (c.veredicto === 'sin_dato' || !(c.veredicto in VALOR)) { sinDato++; continue; }
    const p = PESOS[c.importancia] || 2;
    suma += p * VALOR[c.veredicto];
    pesos += p;
    evaluados++;
    if (c.tipo === 'excluyente' && c.veredicto === 'no') excluyentesFallidos.push(c.texto);
  }
  return {
    puntaje: pesos ? Math.round((suma / pesos) * 100) : null,
    evaluados, sinDato, total: criterios.length, excluyentesFallidos,
  };
}

function recomendacion(ranking) {
  if (ranking.puntaje === null) return REC.sinDatos;
  if (ranking.excluyentesFallidos.length) return ranking.puntaje >= 45 ? REC.cautela : REC.no;
  if (ranking.puntaje >= 70) return REC.si;
  if (ranking.puntaje >= 45) return REC.cautela;
  return REC.no;
}

// ── Pedido a la IA ───────────────────────────────────────────────────────────
// Datos personales sensibles que no deben llegar al cliente (salud, familia, religión,
// política, embarazo, discapacidad...). Si el motivo es personal se escribe "motivos personales".
const SENSIBLES = /\b(m[eé]dic[oa]s?|enferm\w*|salud|c[aá]ncer|embaraz\w*|divorci\w*|separaci[oó]n|fallecimiento|falleci[oó]|duelo|depresi[oó]n|ansiedad|terapia|psic[oó]log\w*|discapacidad|religi[oó]n|religios\w*|pol[ií]tic[oa]s?|hij[oa]s? (enferm\w*|con)|tratamiento)\b/i;

const PROHIBIDAS = ['sólida trayectoria', 'solida trayectoria', 'perfil versátil', 'perfil versatil', 'orientado a resultados', 'gran potencial', 'excelente comunicador', 'excelente comunicadora', 'estimado'];

function construirPrompt(e) {
  const crit = e.criterios.map((c, i) => `${i + 1}. [${c.tipo}, importancia ${c.importancia}] ${c.texto}`).join('\n');
  const sinNotas = !e.notasTexto;
  const pocas = !sinNotas && e.notasTexto.length < 1500;
  const sistema = `Sos un recruiter senior que presenta candidatos a clientes de HWG Talent Consultants. Escribís para el hiring manager: concreto, humano y honesto. No resumís el CV, interpretás qué significa para ESTA posición.

REGLAS QUE NO SE NEGOCIAN:
1. NUNCA inventes. Todo dato sale de las NOTAS, del CV o del SCORECARD. Si algo no está, no lo afirmes.
2. Cada juicio sobre un criterio lleva una CITA: copiada TEXTUAL (palabra por palabra, máx. 200 caracteres) de las notas, del CV o del scorecard. El sistema verifica que la cita exista; si no existe, el juicio se descarta. No parafrasees dentro de la cita.
3. Veredictos: "cumple" SOLO si la cita afirma directamente lo que pide el criterio (si la cita habla de algo parecido o relacionado, pero no de lo que pide el criterio, es "parcial" o "sin_dato"); "parcial" (cumple en parte); "no" (evidencia explícita en contra, con cita); "sin_dato" (no se habló ni surge del CV). Que algo no se haya mencionado NO es "no": es "sin_dato". "sin_dato" no penaliza. Ante la duda entre "cumple" y "parcial", elegí "parcial".
4. DATOS PERSONALES SENSIBLES (salud, embarazo, enfermedades, situación familiar delicada, religión, política): NO los escribas en ningún campo. Si el motivo del cambio o de una salida es personal, escribí "motivos personales".
5. PROHIBIDO en el texto: "sólida trayectoria", "perfil versátil", "orientado a resultados", "gran potencial", "excelente comunicador/a" y la palabra "estimado".
6. Respondé en español, solo con JSON válido.

STORYTELLING (máximo ${MAX_STORYTELLING} caracteres, un párrafo): suena a una persona hablándole al cliente. Cuenta los últimos trabajos con su logro y su motivo de salida, y por qué es la persona ideal para ESTA búsqueda. ${sinNotas ? 'NO HAY NOTAS de entrevista: escribí 2-3 frases basadas solo en el CV y empezá exactamente con "Nota: este perfil se armó solo con el CV, sin entrevista previa."' : pocas ? 'Hay POCAS notas: escribí un texto corto y honesto con lo que salió de la entrevista; no lo rellenes con el CV.' : 'Tiene que salir de la ENTREVISTA, con las palabras del candidato; una frase apoyada solo en el CV no se usa.'}

TECH STACK: entre 5 y 10 herramientas, tecnologías o metodologías (para cualquier perfil, no solo técnicos), con nombre, ordenadas por lo que más pide la posición. "years" solo si el texto liga ESA herramienta con una cantidad de años o con el período de un trabajo donde la usó; si aparece sin período propio, "" (no repitas el mismo número de años en todas). Lo que dijo la entrevista manda sobre el CV.

GAPS: 2 a 3 gaps REALES entre el candidato y la posición, cada uno con una "pregunta" concreta para que el cliente la haga en su entrevista.

Estructura exacta de la respuesta:
{
 "storytelling": "string",
 "criterios": [{"n": 1, "veredicto": "cumple|parcial|no|sin_dato", "cita": "texto textual o ''", "fuente": "notas|cv|scorecard|''", "comentario": "máx. 140 caracteres"}],
 "techStack": [{"tool": "string", "years": "string", "fuente": "notas|cv"}],
 "ingles": "nivel de inglés dicho en notas/CV, o ''",
 "datos": {"motivoCambio": "por qué busca cambiar, con sus palabras y breve, o '' si no se habló", "vacaciones": "vacaciones ya agendadas, o '' si no se habló", "otrosProcesos": "si | no | '' (si no se habló)"},
 "porQueIdeal": "2 a 4 líneas, o '' si no hay base",
 "gaps": [{"title": "string", "detail": "string", "pregunta": "string"}],
 "fitCultural": "${e.cultura.hay ? '3 a 5 líneas con evidencia concreta, o \\"No hay suficiente información para evaluar fit cultural\\"' : ''}",
 "experiencia": [{"role": "string", "company": "string", "period": "string"}]
}
"criterios" lleva UN elemento por cada criterio de la lista, en el mismo orden y con su número "n". "experiencia": los 4 trabajos más recientes del CV, del más nuevo al más viejo.`;

  const partes = [
    `CANDIDATO: ${e.candidato.name}\nPOSICIÓN: ${e.posicion.role}${e.posicion.cliente ? ' en ' + e.posicion.cliente : ''}`,
    crit
      ? `CRITERIOS DE LA POSICIÓN (juzgalos todos):\n${crit}`
      : `NO HAY CRITERIOS ARMADOS para esta posición: devolvé "criterios": [] y evaluá el fit en "porQueIdeal" y "gaps" con esta descripción:\n${e.jdRespaldo || '(sin descripción)'}`,
  ];
  if (e.calibraciones.length) partes.push(`AJUSTES ACORDADOS CON EL CLIENTE:\n${e.calibraciones.map(c => '- ' + c).join('\n')}`);
  partes.push(sinNotas ? 'NOTAS DE ENTREVISTA: no hay.' : `NOTAS DE ENTREVISTA (fuente principal):\n---\n${e.notasTexto}\n---`);
  if (e.scorecardTexto) partes.push(`SCORECARD (completado por la recruiter):\n---\n${e.scorecardTexto}\n---`);
  partes.push(`CV:\n---\n${e.cvTexto}\n---`);
  if (e.cultura.hay) partes.push(`CULTURA DE LA EMPRESA:\n${e.cultura.texto}`);
  return { sistema, usuario: partes.join('\n\n') };
}

// ── Verificación de lo que devolvió la IA ────────────────────────────────────
function limpiarIA(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (x, max = 4000) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  return {
    storytelling: str(r.storytelling, 3000),
    criterios: Array.isArray(r.criterios) ? r.criterios : [],
    techStack: (Array.isArray(r.techStack) ? r.techStack : [])
      .filter(t => t && str(t.tool)).slice(0, 10)
      .map(t => ({ tool: str(t.tool, 60), years: str(t.years, 30).replace(/estimad[oa]s?/gi, '').trim(), fuente: t.fuente === 'cv' ? 'cv' : 'notas' })),
    ingles: str(r.ingles, 120),
    datos: {
      motivoCambio: str(r.datos?.motivoCambio, 400),
      vacaciones: str(r.datos?.vacaciones, 200),
      otrosProcesos: ['si', 'no'].includes(str(r.datos?.otrosProcesos, 5).toLowerCase()) ? str(r.datos.otrosProcesos, 5).toLowerCase() : '',
    },
    porQueIdeal: str(r.porQueIdeal),
    gaps: (Array.isArray(r.gaps) ? r.gaps : []).filter(g => g && str(g.title)).slice(0, 3)
      .map(g => ({ title: str(g.title, 140), detail: str(g.detail, 600), pregunta: str(g.pregunta, 300) })),
    fitCultural: str(r.fitCultural),
    experiencia: (Array.isArray(r.experiencia) ? r.experiencia : []).filter(x => x && str(x.role)).slice(0, 4)
      .map(x => ({ role: str(x.role, 120), company: str(x.company, 120), period: str(x.period, 60) })),
  };
}

// Cruza cada juicio con su criterio, verifica la cita y devuelve la lista final.
function juzgarCriterios(criterios, ia, fuentes) {
  const porN = new Map();
  for (const j of ia.criterios) if (j && Number.isInteger(Number(j.n))) porN.set(Number(j.n), j);
  return criterios.map((c, i) => {
    const j = porN.get(i + 1) || {};
    let veredicto = VEREDICTOS.includes(j.veredicto) ? j.veredicto : 'sin_dato';
    const cita = typeof j.cita === 'string' ? j.cita.trim().slice(0, 300) : '';
    const donde = ['notas', 'cv', 'scorecard'].includes(j.fuente) ? [j.fuente] : [];
    const candidatas = [...donde, ...['notas', 'cv', 'scorecard'].filter(f => !donde.includes(f))];
    const fuenteOk = cita ? candidatas.find(f => citaExiste(cita, fuentes[f] || '')) : null;
    let citaVerificada = !!fuenteOk;
    let nota = '';
    if (veredicto === 'no' && citaVerificada && fuenteOk === 'cv') {
      nota = 'Un "no" apoyado solo en el CV queda sin dato: lo que no aparece en un CV no prueba que no lo tenga';
      veredicto = 'sin_dato';
    }
    if (veredicto !== 'sin_dato' && !citaVerificada) {
      nota = cita ? 'La cita no se encontró en las notas ni en el CV: queda sin dato' : 'Sin cita que lo respalde: queda sin dato';
      veredicto = 'sin_dato';
    }
    return {
      texto: c.texto, tipo: c.tipo, importancia: c.importancia,
      veredicto,
      cita: citaVerificada ? cita : '',
      fuente: fuenteOk || '',
      citaVerificada,
      comentario: typeof j.comentario === 'string' ? j.comentario.trim().slice(0, 200) : '',
      aviso: nota,
    };
  });
}

// ── Encabezado ───────────────────────────────────────────────────────────────
const buscarRespuesta = (scorecard, regex) => {
  const preguntas = scorecard?.preguntas || [];
  const q = preguntas.find(p => regex.test(p.label || ''));
  const v = q ? scorecard?.responses?.[q.id] : '';
  return typeof v === 'string' ? v.trim() : '';
};

// Sueldos viejos escritos como texto ("USD 4.500", "$2.000.000 brutos mensuales"): se
// leen solo para poder comparar con la banda. El texto que se muestra no cambia.
// Se descartan números chicos (años, "13 y 14") y los casos sin moneda clara.
function sueldoDeTextoViejo(texto) {
  const t = String(texto || '').toLowerCase();
  const montos = montosDeTexto(t).filter(n => n >= 100);
  if (!montos.length) return null;
  const usd = /usd|u\$s|us\$|d[oó]lar/.test(t);
  const ars = !usd && /\$|ars|peso/.test(t);
  if (!usd && !ars) return null;
  const hora = /por hora|\/\s*h\b|\bhora\b/.test(t);
  const mensual = !hora && /mensual|por mes|al mes|\/\s*mes|\bmes\b/.test(t);
  return { monto: String(Math.max(...montos)), moneda: usd ? 'USD' : 'ARS', periodo: hora ? 'hora' : mensual ? 'mensual' : '' };
}

// "USD 3.500 mensual" / "$ 2.000.000 mensual" / "USD 25 por hora" (igual que en el ATS).
function textoSueldo({ monto, moneda, periodo } = {}) {
  const m = String(monto || '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  if (!m) return '';
  const cifra = m.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const base = moneda === 'ARS' ? `$ ${cifra}` : moneda === 'USD' ? `USD ${cifra}` : cifra;
  return base + (periodo === 'hora' ? ' por hora' : periodo === 'mensual' ? ' mensual' : '');
}

function armarEncabezado({ scorecard, posicion, candidato, datosIA }) {
  const o = scorecard?.obligatorio || {};
  const n = o.salario_num || {};
  const visible = n.visible !== false;
  const sueldo = n.monto
    ? { monto: String(n.monto), moneda: n.moneda || '', periodo: n.periodo || '' }
    : sueldoDeTextoViejo(o.salario);
  const banda = parsearBanda(posicion.salary_band, posicion.salary_currency);
  const originalSueldo = String(o.salario || '').trim();
  const sueldoNormal = sueldo ? textoSueldo(sueldo) : '';
  const ia = datosIA || {};
  const motivo = (o.motivo_cambio || '').trim();
  const vac = (o.vacaciones || '').trim();
  const otros = o.otros_procesos === 'si' || o.otros_procesos === 'no' ? o.otros_procesos : '';
  return {
    ubicacion: candidato.location || '',
    modalidad: posicion.modality || '',
    // El sueldo se muestra UNA vez y siempre igual ("USD 10.000 mensual"). Si el texto
    // original traía aclaraciones (bonos, 13 y 14...) queda aparte como nota, solo para la recruiter.
    sueldo: {
      texto: visible ? (sueldoNormal || originalSueldo) : '',
      nota: visible && sueldoNormal && originalSueldo && sueldoNormal !== originalSueldo ? originalSueldo : '',
      visible,
      comparacion: visible ? compararConBanda(sueldo, banda) : null,
    },
    disponibilidad: buscarRespuesta(scorecard, /disponibilidad/i) || 'a confirmar',
    // Lo que la recruiter cargó en el scorecard manda; si falta, se toma de las notas
    // y se marca de dónde salió para que lo revise.
    vacaciones: vac || ia.vacaciones || '',
    motivoCambio: motivo || ia.motivoCambio || '',
    otrosProcesos: otros || ia.otrosProcesos || '',
    origen: {
      vacaciones: vac ? 'scorecard' : ia.vacaciones ? 'notas' : '',
      motivoCambio: motivo ? 'scorecard' : ia.motivoCambio ? 'notas' : '',
      otrosProcesos: otros ? 'scorecard' : ia.otrosProcesos ? 'notas' : '',
    },
  };
}

// ── Chequeo de calidad (la lista de control, la parte que se mide sola) ──────
function chequeoCalidad(inf, { sinNotas, criteriosConfirmados }) {
  const item = (clave, ok, detalle) => ({ clave, ok, detalle });
  const h = inf.header;
  const evaluados = inf.ranking.criterios.filter(c => c.veredicto !== 'sin_dato');
  const citasMalas = inf.ranking.criterios.filter(c => c.aviso).length;
  const largo = inf.storytelling.length;
  const prohibidas = PROHIBIDAS.filter(p => inf.storytelling.toLowerCase().includes(p));
  const incoherente = (inf.ranking.excluyentesFallidos.length && inf.recommendation === REC.si)
    || (inf.ranking.puntaje !== null && inf.ranking.puntaje < 45 && inf.recommendation === REC.si);
  return [
    item('completo', !!(h.sueldo.texto || !h.sueldo.visible) && !!h.motivoCambio && h.otrosProcesos !== '',
      `sueldo ${h.sueldo.texto ? 'sí' : 'no'}, motivo ${h.motivoCambio ? 'sí' : 'no'}, otros procesos ${h.otrosProcesos || 'no'}`),
    item('ranking_real', inf.ranking.puntaje !== null,
      inf.ranking.puntaje === null ? 'sin criterios evaluables' : `${evaluados.length} de ${inf.ranking.total} criterios con dato${criteriosConfirmados ? '' : '; criterios estándar sin confirmar'}`),
    item('storytelling', largo > 0 && largo <= MAX_STORYTELLING && !prohibidas.length,
      `${largo} caracteres${prohibidas.length ? '; frases prohibidas: ' + prohibidas.join(', ') : ''}`),
    item('con_evidencia', citasMalas === 0 && (sinNotas || evaluados.every(c => c.citaVerificada)),
      citasMalas ? `${citasMalas} cita(s) no encontradas en las notas` : 'todas las citas existen en las notas o el CV'),
    item('gaps_que_sirven', inf.mirada.gaps.length >= 1 && inf.mirada.gaps.every(g => g.pregunta),
      `${inf.mirada.gaps.length} gap(s), ${inf.mirada.gaps.filter(g => g.pregunta).length} con pregunta`),
    item('tech_stack', inf.techStack.length >= 5 && inf.techStack.length <= 10,
      `${inf.techStack.length} herramientas`),
    item('sin_datos_sensibles', !SENSIBLES.test([inf.storytelling, inf.header.motivoCambio, inf.header.vacaciones, inf.mirada.porQueIdeal, inf.fitCultural].join(' ')),
      'sin datos personales sensibles en el texto que ve el cliente'),
    item('sin_contradicciones', !incoherente, incoherente ? 'la recomendación no coincide con el ranking' : 'ranking y recomendación coinciden'),
  ];
}


// Texto del scorecard para la IA (misma idea que el informe actual). El sueldo solo
// viaja si la recruiter lo dejó visible.
function serializarScorecard(sc) {
  if (!sc) return '';
  const o = sc.obligatorio || {};
  const visible = o.salario_num?.visible !== false;
  const lineas = [];
  const rec = { avanzar: 'Avanzar', no_avanzar: 'No avanzar', en_duda: 'En duda' }[sc.recomendacion];
  if (rec) lineas.push(`Recomendación de la recruiter: ${rec}`);
  if (o.anios_exp) lineas.push(`Años de experiencia relevante: ${o.anios_exp}`);
  if (o.cumple_req) lineas.push(`¿Cumple requisitos mínimos?: ${o.cumple_req === 'si' ? 'Sí' : 'No'}`);
  if (o.salario && visible) lineas.push(`Pretensión salarial: ${o.salario}`);
  if (o.motivo_cambio) lineas.push(`Motivo del cambio: ${o.motivo_cambio}`);
  if (o.vacaciones) lineas.push(`Vacaciones agendadas: ${o.vacaciones}`);
  if (o.otros_procesos) lineas.push(`Otros procesos abiertos: ${o.otros_procesos === 'si' ? 'Sí' : 'No'}`);
  if (sc.notas_cv) lineas.push(`Resumen del CV: ${sc.notas_cv}`);
  if (Array.isArray(sc.fit_cultural_tags) && sc.fit_cultural_tags.length) lineas.push(`Fit cultural evaluado: ${sc.fit_cultural_tags.join(', ')}`);
  const porId = Object.fromEntries((sc.preguntas || []).map(p => [p.id, p.label]));
  const resp = Object.entries(sc.responses || {}).filter(([k, v]) => k !== 'recomendacion_final' && v && porId[k]);
  if (resp.length) { lineas.push('Respuestas del scorecard:'); resp.forEach(([k, v]) => lineas.push(`- ${porId[k]}: ${v}`)); }
  return lineas.join('\n');
}

// Costo aproximado en dólares (precios por millón de tokens; son una referencia).
const PRECIOS = { haiku: [1, 5], sonnet: [3, 15], opus: [5, 25] };
function costoAprox(modelo, entrada, salida) {
  const [i, o] = PRECIOS[modelo] || [0, 0];
  return Math.round(((entrada * i + salida * o) / 1e6) * 10000) / 10000;
}

// ── Ensamblado final ─────────────────────────────────────────────────────────
function ensamblarInforme({ entrada, ia: iaCruda, fuentes }) {
  const ia = limpiarIA(iaCruda);
  const criteriosJuzgados = juzgarCriterios(entrada.criterios, ia, fuentes);
  const ranking = { ...calcularRanking(criteriosJuzgados), criterios: criteriosJuzgados };
  const recomend = recomendacion(ranking);
  const header = armarEncabezado({ ...entrada, datosIA: ia.datos });
  const sinNotas = !entrada.notasTexto;
  let story = ia.storytelling.slice(0, MAX_STORYTELLING);
  if (sinNotas && story && !/sin entrevista previa/i.test(story)) story = ('Nota: este perfil se armó solo con el CV, sin entrevista previa. ' + story).slice(0, MAX_STORYTELLING);
  const c = entrada.candidato, p = entrada.posicion;
  const informe = {
    version: 2,
    name: c.name, role: p.role, location: header.ubicacion, modality: header.modalidad,
    header,
    storytelling: story,
    ranking,
    techStack: ia.techStack,
    mirada: { porQueIdeal: ia.porQueIdeal, gaps: ia.gaps },
    fitCultural: entrada.cultura.hay ? ia.fitCultural : '',
    experiencia: ia.experiencia,
    ingles: ia.ingles,
    recommendation: recomend,
    // — compatibilidad con el formato anterior —
    personal: { linkedin: c.linkedin_url || '', phone: c.phone || '', email: c.email || '', salary: header.sueldo.texto, availability: header.disponibilidad, company: p.cliente || '' },
    snapshot: { techFit: ranking.puntaje === null ? '' : `${Math.round(ranking.puntaje / 10)}/10`, exp: '', cult: '', englishLevel: ia.ingles || 'No especificado' },
    tools: ia.techStack.map(t => ({ tool: t.tool, years: t.years })),
    experience: ia.experiencia,
    gap: ia.gaps.map(g => ({ title: g.title, detail: g.pregunta ? `${g.detail} Pregunta para la entrevista: ${g.pregunta}` : g.detail })),
    analisis: ia.porQueIdeal,
  };
  if (entrada.cultura.etiquetas.length) informe.culturalTags = entrada.cultura.etiquetas;
  informe.qa = chequeoCalidad(informe, { sinNotas, criteriosConfirmados: entrada.criteriosConfirmados });
  informe.criteriosConfirmados = entrada.criteriosConfirmados;
  return informe;
}

module.exports = {
  SENSIBLES, MAX_NOTAS, MAX_CV, MAX_JD_RESPALDO, MAX_STORYTELLING, REC, PROHIBIDAS,
  normalizar, citaExiste, recortarMedio, juntarNotasCandidato, criteriosDeJD,
  parsearBanda, compararConBanda, sueldoDeTextoViejo, textoSueldo, calcularRanking, recomendacion,
  serializarScorecard, costoAprox, construirPrompt, limpiarIA, juzgarCriterios, armarEncabezado, chequeoCalidad, ensamblarInforme,
};
