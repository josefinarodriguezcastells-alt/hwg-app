// Motor del informe v2: todo lo que no necesita IA. Sin llamadas externas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../api/_informeV2.js');

const NOTAS = `[NOTAS subidas el 24/09/2026 — entrevista.txt]
Trabajé cinco años en Mercado Libre liderando un equipo de 8 personas en Colombia. Me fui porque la empresa recortó el área.
Hoy cobro 6.000 dólares y busco algo similar. Hablo inglés fluido, lo uso todos los días con la casa matriz.
Tengo otro proceso abierto con una fintech, estoy en la etapa final. Vacaciones agendadas en enero, dos semanas.`;
const CV = 'Juan Pérez. Country Manager en Mercado Libre 2019-2024. Antes Gerente comercial en Rappi 2016-2019. Excel, Salesforce, SQL.';

test('citaExiste: exacta, sin importar mayúsculas, tildes ni espacios', () => {
  assert.ok(M.citaExiste('liderando un equipo de 8 personas en colombia', NOTAS));
  assert.ok(M.citaExiste('Trabajé  CINCO años en Mercado Libre', NOTAS));
  assert.ok(M.citaExiste('Hablo ingles fluido, lo uso todos los dias', NOTAS));
});

test('citaExiste: tolera un cambio chico pero rechaza lo inventado', () => {
    assert.ok(M.citaExiste('Trabajé cinco años en Mercado Libre liderando un equipo de ocho personas en Colombia', NOTAS), 'una palabra cambiada');
  assert.equal(M.citaExiste('Dirigí una operación de 200 personas en Brasil durante diez años', NOTAS), false);
  assert.equal(M.citaExiste('Excel', NOTAS), false, 'muy corta');
  assert.equal(M.citaExiste('', NOTAS), false);
});

test('varias notas: se leen todas, de la más vieja a la más nueva', () => {
  const r = M.juntarNotasCandidato([{ fecha: '10/09', nombre: 'a.txt', texto: 'PRIMERA' }, { fecha: '24/09', nombre: 'b.txt', texto: 'SEGUNDA' }]);
  assert.ok(r.texto.indexOf('PRIMERA') < r.texto.indexOf('SEGUNDA'));
  assert.equal(r.cantidad, 2); assert.equal(r.recortado, false);
});

test('si las notas no entran, se descartan primero las más viejas y se avisa', () => {
  const r = M.juntarNotasCandidato([{ texto: 'VIEJA' + 'x'.repeat(600) }, { texto: 'NUEVA' + 'y'.repeat(600) }], 1000);
  assert.ok(r.texto.includes('NUEVA') && !r.texto.includes('VIEJA'));
  assert.equal(r.recortado, true);
  assert.equal(M.juntarNotasCandidato([]).texto, '');
  const gigante = M.juntarNotasCandidato([{ texto: 'INICIO' + 'z'.repeat(5000) + 'FINAL' }], 1000);
  assert.ok(gigante.texto.includes('INICIO') && gigante.texto.includes('FINAL') && gigante.recortado);
});

test('criterios: usa los de la JD; sin ellos arma respaldo con los requisitos; sin nada, vacío', () => {
  const a = M.criteriosDeJD({ _confirmado: { quien: 'Ana' }, criterios: [{ texto: 'Java 5+', tipo: 'excluyente', importancia: 'alta' }, { texto: 'Inglés', tipo: 'raro', importancia: 'xx' }] });
  assert.equal(a.origen, 'criterios'); assert.equal(a.confirmados, true);
  assert.deepEqual(a.criterios[1], { texto: 'Inglés', tipo: 'deseable', importancia: 'media' });
  const b = M.criteriosDeJD({ requisitos_excluyentes: 'Liderazgo de equipos. Inglés avanzado', requisitos_deseables: 'SQL' });
  assert.equal(b.origen, 'requisitos'); assert.equal(b.confirmados, false);
  assert.deepEqual(b.criterios.map(c => [c.tipo, c.importancia]), [['excluyente', 'media'], ['excluyente', 'media'], ['deseable', 'baja']]);
  assert.equal(M.criteriosDeJD(null).origen, 'ninguno');
  assert.equal(M.criteriosDeJD({ criterios: Array.from({ length: 30 }, (_, i) => ({ texto: 'c' + i })) }).criterios.length, 12);
});

test('banda: lee los formatos reales y compara sin bloquear', () => {
  assert.deepEqual(M.parsearBanda('3500-5500', 'USD'), { min: 3500, max: 5500, moneda: 'USD' });
  assert.deepEqual(M.parsearBanda('4000000-4600000', 'ARS'), { min: 4000000, max: 4600000, moneda: 'ARS' });
  assert.deepEqual(M.parsearBanda('3500/4000', 'USD'), { min: 3500, max: 4000, moneda: 'USD' });
  assert.deepEqual(M.parsearBanda('5.000.000', 'ARS'), { min: 5000000, max: 5000000, moneda: 'ARS' });
  assert.equal(M.parsearBanda('', 'USD'), null);
  const b = { min: 3500, max: 5500, moneda: 'USD' };
  const s = (monto, moneda = 'USD', periodo = 'mensual') => ({ monto, moneda, periodo });
  assert.equal(M.compararConBanda(s('6000'), b), 'arriba');
  assert.equal(M.compararConBanda(s('3000'), b), 'abajo');
  assert.equal(M.compararConBanda(s('4000'), b), 'dentro');
  assert.equal(M.compararConBanda(s('4000', 'ARS'), b), null, 'moneda distinta: no se compara');
  assert.equal(M.compararConBanda(s('40', 'USD', 'hora'), b), null, 'por hora: no se compara con una banda mensual');
  assert.equal(M.compararConBanda(null, b), null);
  assert.equal(M.compararConBanda(s('4000'), { ...b, moneda: '' }), null);
});

const J = (tipo, importancia, veredicto) => ({ texto: `${tipo}-${importancia}-${veredicto}`, tipo, importancia, veredicto });

test('ranking: pesos 3/2/1, parcial vale la mitad y "sin dato" no suma ni resta', () => {
  const r = M.calcularRanking([J('excluyente', 'alta', 'cumple'), J('deseable', 'media', 'parcial'), J('deseable', 'baja', 'no'), J('deseable', 'alta', 'sin_dato')]);
  assert.equal(r.puntaje, Math.round(((3 + 1) / (3 + 2 + 1)) * 100)); // 67
  assert.equal(r.evaluados, 3); assert.equal(r.sinDato, 1); assert.equal(r.total, 4);
  assert.deepEqual(r.excluyentesFallidos, []);
});

test('ranking: un excluyente que no se cumple se avisa aparte; todo sin dato no da puntaje', () => {
  const r = M.calcularRanking([J('excluyente', 'alta', 'no'), J('deseable', 'media', 'cumple')]);
  assert.deepEqual(r.excluyentesFallidos, ['excluyente-alta-no']);
  assert.equal(M.calcularRanking([J('deseable', 'baja', 'sin_dato')]).puntaje, null);
  assert.equal(M.calcularRanking([]).puntaje, null);
});

test('recomendación: umbrales y excluyentes', () => {
  const rk = (puntaje, fallidos = []) => ({ puntaje, excluyentesFallidos: fallidos });
  assert.equal(M.recomendacion(rk(85)), M.REC.si);
  assert.equal(M.recomendacion(rk(55)), M.REC.cautela);
  assert.equal(M.recomendacion(rk(30)), M.REC.no);
  assert.equal(M.recomendacion(rk(90, ['x'])), M.REC.cautela, 'con un excluyente fallido nunca es "recomendado"');
  assert.equal(M.recomendacion(rk(40, ['x'])), M.REC.no);
  assert.equal(M.recomendacion(rk(null)), M.REC.sinDatos);
});

const CRITERIOS = [
  { texto: 'Liderazgo de equipos de 5+ personas', tipo: 'excluyente', importancia: 'alta' },
  { texto: 'Inglés avanzado', tipo: 'excluyente', importancia: 'media' },
  { texto: 'Experiencia en fintech', tipo: 'deseable', importancia: 'baja' },
];
const FUENTES = { notas: NOTAS, cv: CV, scorecard: '' };

test('juzgar: la cita verificada se conserva; la inventada o ausente deja el criterio sin dato', () => {
  const ia = { criterios: [
    { n: 1, veredicto: 'cumple', cita: 'liderando un equipo de 8 personas en Colombia', fuente: 'notas', comentario: 'ok' },
    { n: 2, veredicto: 'cumple', cita: 'Habla inglés nativo desde la infancia en Londres', fuente: 'notas' },
    { n: 3, veredicto: 'no', cita: '' },
  ] };
  const r = M.juzgarCriterios(CRITERIOS, M.limpiarIA(ia), FUENTES);
  assert.equal(r[0].veredicto, 'cumple'); assert.equal(r[0].citaVerificada, true); assert.equal(r[0].fuente, 'notas');
  assert.equal(r[1].veredicto, 'sin_dato'); assert.match(r[1].aviso, /no se encontró/);
  assert.equal(r[2].veredicto, 'sin_dato', '"no" sin cita no vale: no haber hablado del tema no es un "no"');
});

test('juzgar: si la IA cita del CV pero dice notas, igual se encuentra y se corrige la fuente', () => {
  const ia = { criterios: [{ n: 1, veredicto: 'cumple', cita: 'Gerente comercial en Rappi 2016-2019', fuente: 'notas' }] };
  const r = M.juzgarCriterios([CRITERIOS[0]], M.limpiarIA(ia), FUENTES);
  assert.equal(r[0].veredicto, 'cumple'); assert.equal(r[0].fuente, 'cv');
});

test('juzgar: veredicto desconocido o criterio sin juicio → sin dato (nunca se inventa)', () => {
  const r = M.juzgarCriterios(CRITERIOS, M.limpiarIA({ criterios: [{ n: 1, veredicto: 'excelente' }] }), FUENTES);
  assert.deepEqual(r.map(x => x.veredicto), ['sin_dato', 'sin_dato', 'sin_dato']);
});

const SCORECARD = {
  obligatorio: { nombre: 'Juan', salario: 'USD 6.000 mensual', salario_num: { monto: '6000', moneda: 'USD', periodo: 'mensual', visible: true }, motivo_cambio: 'Recorte del área', vacaciones: 'Enero, dos semanas', otros_procesos: 'si' },
  preguntas: [{ id: 'q1', label: 'DISPONIBILIDAD PARA EMPEZAR' }],
  responses: { q1: '30 días de preaviso' },
};
const entrada = (extra = {}) => ({
  candidato: { name: 'Juan Pérez', location: 'Bogotá', linkedin_url: 'https://linkedin.com/in/jp', phone: '', email: 'jp@x.com' },
  posicion: { role: 'Country Manager COL', cliente: 'Pomelo', salary_band: '4000-5500', salary_currency: 'USD', modality: 'Híbrido' },
  criterios: CRITERIOS, criteriosConfirmados: true, calibraciones: [], jdRespaldo: '',
  notasTexto: NOTAS, cvTexto: CV, scorecardTexto: '', scorecard: SCORECARD,
  cultura: { hay: true, texto: 'Startup, ownership', etiquetas: ['Startup', 'Ownership'] },
  ...extra,
});
const IA_OK = {
  storytelling: 'Juan lideró durante cinco años un equipo de 8 personas en Mercado Libre Colombia y salió porque recortaron el área. Hoy busca algo similar y tiene un proceso final en una fintech.',
  criterios: [
    { n: 1, veredicto: 'cumple', cita: 'liderando un equipo de 8 personas en Colombia', fuente: 'notas' },
    { n: 2, veredicto: 'cumple', cita: 'Hablo inglés fluido, lo uso todos los días', fuente: 'notas' },
    { n: 3, veredicto: 'parcial', cita: 'Tengo otro proceso abierto con una fintech', fuente: 'notas' },
  ],
  techStack: ['Excel', 'Salesforce', 'SQL', 'Liderazgo comercial', 'Negociación', 'Forecasting'].map(t => ({ tool: t, years: '5 años estimados', fuente: 'cv' })),
  ingles: 'Fluido', porQueIdeal: 'Ya hizo el rol en una operación grande.',
  gaps: [{ title: 'Sin experiencia en la industria del cliente', detail: 'Viene de e-commerce.', pregunta: '¿Cómo encararía el primer trimestre sin conocer el sector?' }],
  fitCultural: 'Habla de ownership con ejemplos concretos.',
  experiencia: [{ role: 'Country Manager', company: 'Mercado Libre', period: '2019-2024' }],
};

test('encabezado: sueldo contra la banda, disponibilidad, vacaciones, motivo y otros procesos', () => {
  const h = M.armarEncabezado(entrada());
  assert.equal(h.sueldo.texto, 'USD 6.000 mensual'); assert.equal(h.sueldo.comparacion, 'arriba');
  assert.equal(h.disponibilidad, '30 días de preaviso'); assert.equal(h.vacaciones, 'Enero, dos semanas');
  assert.equal(h.motivoCambio, 'Recorte del área'); assert.equal(h.otrosProcesos, 'si');
  assert.equal(h.modalidad, 'Híbrido'); assert.equal(h.ubicacion, 'Bogotá');
});

test('encabezado: con "visible = no" no se muestra el sueldo ni la flecha ni nada que lo deje deducir', () => {
  const sc = { ...SCORECARD, obligatorio: { ...SCORECARD.obligatorio, salario_num: { ...SCORECARD.obligatorio.salario_num, visible: false } } };
  const h = M.armarEncabezado(entrada({ scorecard: sc }));
  assert.equal(h.sueldo.texto, ''); assert.equal(h.sueldo.comparacion, null); assert.equal(h.sueldo.visible, false);
});

test('encabezado: sin scorecard no rompe; disponibilidad dice "a confirmar"', () => {
  const h = M.armarEncabezado(entrada({ scorecard: null }));
  assert.equal(h.disponibilidad, 'a confirmar'); assert.equal(h.sueldo.texto, ''); assert.equal(h.otrosProcesos, '');
});

test('informe completo: formato nuevo + campos del formato anterior + chequeo de calidad', () => {
  const inf = M.ensamblarInforme({ entrada: entrada(), ia: IA_OK, fuentes: FUENTES });
  assert.equal(inf.version, 2);
  assert.equal(inf.ranking.puntaje, 92); // (3 + 2 + 0,5) / (3 + 2 + 1)
  assert.equal(inf.ranking.criterios.length, 3);
  // compatibilidad con las pantallas actuales
  for (const k of ['name', 'role', 'personal', 'snapshot', 'tools', 'experience', 'storytelling', 'gap', 'recommendation', 'fitCultural', 'analisis']) assert.ok(k in inf, k);
  assert.equal(inf.personal.salary, 'USD 6.000 mensual'); assert.equal(inf.personal.company, 'Pomelo');
  assert.match(inf.gap[0].detail, /Pregunta para la entrevista/);
  assert.deepEqual(inf.culturalTags, ['Startup', 'Ownership']);
  // "estimado" nunca llega al informe
  assert.ok(inf.techStack.every(t => !/estimad/i.test(t.years)));
  assert.equal(inf.qa.length, 7);
  assert.ok(inf.qa.find(q => q.clave === 'con_evidencia').ok);
  assert.ok(inf.qa.find(q => q.clave === 'tech_stack').ok);
});

test('storytelling: tope de 1.000 caracteres y sin notas lleva el aviso al principio', () => {
  const largo = M.ensamblarInforme({ entrada: entrada(), ia: { ...IA_OK, storytelling: 'a '.repeat(1500) }, fuentes: FUENTES });
  assert.ok(largo.storytelling.length <= 1000);
  const sin = M.ensamblarInforme({ entrada: entrada({ notasTexto: '' }), ia: { ...IA_OK, storytelling: 'Trabajó en retail.' }, fuentes: { ...FUENTES, notas: '' } });
  assert.match(sin.storytelling, /^Nota: este perfil se armó solo con el CV, sin entrevista previa\./);
});

test('sin criterios: no hay ranking inventado, hay recomendación "sin información"', () => {
  const inf = M.ensamblarInforme({ entrada: entrada({ criterios: [], criteriosConfirmados: false }), ia: { ...IA_OK, criterios: [] }, fuentes: FUENTES });
  assert.equal(inf.ranking.puntaje, null); assert.equal(inf.recommendation, M.REC.sinDatos);
  assert.equal(inf.snapshot.techFit, '');
});

test('chequeo de calidad: detecta frases prohibidas, citas falsas y contradicciones', () => {
  const mala = M.ensamblarInforme({
    entrada: entrada(),
    ia: { ...IA_OK, storytelling: 'Tiene una sólida trayectoria.', criterios: [{ n: 1, veredicto: 'cumple', cita: 'Dirigí cuarenta países desde Miami sin parar', fuente: 'notas' }] },
    fuentes: FUENTES,
  });
  const q = Object.fromEntries(mala.qa.map(x => [x.clave, x]));
  assert.equal(q.storytelling.ok, false); assert.equal(q.con_evidencia.ok, false);
});

test('pedido a la IA: reglas, criterios numerados, tres casos de notas y límites', () => {
  const p = M.construirPrompt(entrada({ notasTexto: NOTAS + ' '.repeat(10) + 'x'.repeat(1600) }));
  assert.match(p.sistema, /NUNCA inventes/); assert.match(p.sistema, /TEXTUAL/); assert.match(p.sistema, /1\.000|1000/);
  assert.match(p.usuario, /1\. \[excluyente, importancia alta\] Liderazgo/); assert.match(p.usuario, /3\. \[deseable, importancia baja\]/);
  assert.match(p.sistema, /Tiene que salir de la ENTREVISTA/);
  const pocas = M.construirPrompt(entrada({ notasTexto: 'Busca cambiar por sueldo.' }));
  assert.match(pocas.sistema, /POCAS notas/);
  const sin = M.construirPrompt(entrada({ notasTexto: '' }));
  assert.match(sin.sistema, /NO HAY NOTAS/); assert.match(sin.usuario, /NOTAS DE ENTREVISTA: no hay/);
  const sinCrit = M.construirPrompt(entrada({ criterios: [], jdRespaldo: 'Buscamos gerente comercial' }));
  assert.match(sinCrit.usuario, /NO HAY CRITERIOS/); assert.match(sinCrit.usuario, /Buscamos gerente comercial/);
});

test('scorecard para la IA: incluye los datos nuevos y respeta el sueldo oculto', () => {
  const t = M.serializarScorecard(SCORECARD);
  assert.match(t, /Pretensión salarial: USD 6\.000 mensual/); assert.match(t, /Motivo del cambio: Recorte del área/);
  assert.match(t, /Otros procesos abiertos: Sí/); assert.match(t, /DISPONIBILIDAD PARA EMPEZAR: 30 días de preaviso/);
  const oculto = M.serializarScorecard({ ...SCORECARD, obligatorio: { ...SCORECARD.obligatorio, salario_num: { visible: false } } });
  assert.ok(!/salarial/.test(oculto), 'el sueldo oculto no viaja a la IA');
  assert.equal(M.serializarScorecard(null), '');
});

test('costo aproximado: función de tokens y modelo', () => {
  assert.equal(M.costoAprox('haiku', 10000, 2000), 0.02);
  assert.equal(M.costoAprox('desconocido', 1, 1), 0);
});
