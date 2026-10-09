// api/informe-v2-prueba: solo owner, solo lectura, una llamada a la IA. Todo simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

process.env.SESSION_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'sk-fake';
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY_V2 = 'sb_secret_fake';

const APP = '11111111-1111-4111-8111-111111111111';
const CAND = '22222222-2222-4222-8222-222222222222';
const POS = '33333333-3333-4333-8333-333333333333';

const realFetch = globalThis.fetch;
let llamadas = [];
let iaRespuesta = null;
let cvTexto = 'Juan Pérez. Country Manager en Mercado Libre 2019-2024. Excel, Salesforce, SQL, liderazgo de equipos comerciales en LATAM.';
const NOTAS1 = 'Primera charla: trabajé cinco años liderando un equipo de 8 personas en Colombia.';
const NOTAS2 = 'Segunda charla: hablo inglés fluido y cobro 6.000 dólares.';

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  llamadas.push({ url, method: opts.method || 'GET', body: opts.body });
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://sb.test/rest/v1/applications')) return json([{ id: APP, candidate_id: CAND, position_id: POS }]);
  if (url.startsWith('https://sb.test/rest/v1/candidates')) return json([{ name: 'Juan Pérez', location: 'Bogotá', email: 'jp@x.com', cv_url: 'https://sb.test/storage/cv.txt' }]);
  if (url.startsWith('https://sb.test/rest/v1/positions')) return json([{ role: 'Country Manager COL', client_id: 'c1', salary_band: '4000-5500', salary_currency: 'USD', modalidad: 'Híbrido',
    jd_structured: { _confirmado: { quien: 'Ana' }, criterios: [{ texto: 'Liderazgo de equipos de 5+ personas', tipo: 'excluyente', importancia: 'alta' }, { texto: 'Inglés avanzado', tipo: 'deseable', importancia: 'media' }], calibraciones: [{ texto: 'El cliente acepta 3 años de experiencia' }] } }]);
  if (url.startsWith('https://sb.test/rest/v1/clients')) return json([{ name: 'Pomelo', cultural_tags: '["startup","ownership"]', cultural_comment: 'Cultura de dueños' }]);
  if (url.startsWith('https://sb.test/rest/v1/scorecards')) return json([{ id: 's1', template_id: 't1', recomendacion: 'avanzar', obligatorio: { anios_exp: '8 años', salario: 'USD 6.000 mensual', salario_num: { monto: '6000', moneda: 'USD', periodo: 'mensual', visible: true }, motivo_cambio: 'Recorte del área', otros_procesos: 'si' }, responses: { q1: '30 días' } }]);
  if (url.startsWith('https://sb.test/rest/v1/scorecard_templates')) return json([{ preguntas: [{ id: 'q1', label: 'Disponibilidad para empezar' }] }]);
  if (url.startsWith('https://sb.test/rest/v1/candidate_documents')) return json([
    { name: 'a.txt', url: 'https://sb.test/storage/a.txt', created_at: '2026-09-10T10:00:00Z' },
    { name: 'b.txt', url: 'https://sb.test/storage/b.txt', created_at: '2026-09-24T10:00:00Z' }]);
  if (url === 'https://sb.test/storage/cv.txt') return new Response(cvTexto);
  if (url === 'https://sb.test/storage/a.txt') return new Response(NOTAS1);
  if (url === 'https://sb.test/storage/b.txt') return new Response(NOTAS2);
  if (url.startsWith('https://api.anthropic.com')) {
    return json({ content: [{ type: 'text', text: JSON.stringify(iaRespuesta) }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 1200 } });
  }
  throw new Error('fetch no mockeado: ' + url);
};

const IA = {
  storytelling: 'Juan lideró cinco años un equipo de 8 personas y hoy cobra 6.000 dólares.',
  criterios: [
    { n: 1, veredicto: 'cumple', cita: 'liderando un equipo de 8 personas en Colombia', fuente: 'notas' },
    { n: 2, veredicto: 'cumple', cita: 'hablo inglés fluido', fuente: 'notas' },
  ],
  techStack: ['Excel', 'Salesforce', 'SQL', 'Liderazgo', 'Negociación'].map(t => ({ tool: t, years: '', fuente: 'cv' })),
  gaps: [{ title: 'Industria nueva', detail: 'Viene de e-commerce', pregunta: '¿Cómo encararía el sector?' }],
  porQueIdeal: 'Ya hizo el rol.', fitCultural: 'Habla de ownership.', experiencia: [{ role: 'Country Manager', company: 'Mercado Libre', period: '2019-2024' }],
};

let server, base;
before(async () => {
  const m = await import(new URL('../api/informe-v2-prueba.js', import.meta.url));
  const handler = m.default || m;
  server = http.createServer(async (req, res) => {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    let raw = ''; for await (const c of req) raw += c; req.body = JSON.parse(raw || '{}');
    await handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

const post = (body, rol) => realFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(rol ? { Authorization: 'Bearer ' + jwt.sign({ id: 'u1', email: 'x@x.com', role: rol }, 'test-secret') } : {}) }, body: JSON.stringify(body) });

test('sin sesión 401, recruiter 403, y no se llama a nada', async () => {
  llamadas = [];
  assert.equal((await post({ application_id: APP })).status, 401);
  assert.equal((await post({ application_id: APP }, 'recruiter')).status, 403);
  assert.equal((await post({ application_id: APP }, 'client')).status, 403);
  assert.equal(llamadas.length, 0);
});

test('entradas inválidas: 400 sin tocar la base ni la IA', async () => {
  llamadas = [];
  assert.equal((await post({ application_id: 'x; drop table' }, 'owner')).status, 400);
  assert.equal((await post({ application_id: APP, modelo: 'gpt' }, 'owner')).status, 400);
  assert.equal(llamadas.length, 0);
});

test('owner: arma el informe, lee todas las notas en orden, usa los criterios y no escribe nada', async () => {
  llamadas = []; iaRespuesta = IA;
  const r = await post({ application_id: APP }, 'owner');
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.informe.version, 2);
  assert.equal(j.informe.ranking.puntaje, 100);
  assert.equal(j.informe.header.sueldo.comparacion, 'arriba');
  assert.equal(j.informe.header.disponibilidad, '30 días');
  assert.deepEqual(j.informe.culturalTags, ['Startup', 'Ownership']);
  assert.equal(j.entrada.documentos_de_notas, 2); assert.equal(j.entrada.origen_criterios, 'criterios'); assert.equal(j.entrada.criterios_confirmados, true);
  assert.equal(j.uso.entrada, 4000); assert.ok(j.uso.costo_usd_aprox > 0);
  // solo lecturas a la base; una sola llamada a la IA
  const supa = llamadas.filter(l => l.url.startsWith('https://sb.test/rest'));
  assert.ok(supa.length >= 6 && supa.every(l => l.method === 'GET'), 'solo GET a la base');
  const ia = llamadas.filter(l => l.url.startsWith('https://api.anthropic.com'));
  assert.equal(ia.length, 1);
  const cuerpo = JSON.parse(ia[0].body);
  assert.equal(cuerpo.model, 'claude-haiku-4-5-20251001'); assert.equal(cuerpo.max_tokens, 8000);
  const prompt = cuerpo.messages[0].content;
  assert.ok(prompt.indexOf('Primera charla') < prompt.indexOf('Segunda charla'), 'notas de la más vieja a la más nueva');
  assert.ok(prompt.includes('El cliente acepta 3 años'), 'ajustes acordados con el cliente');
  assert.ok(prompt.includes('Cultura de dueños'));
});

test('modelo elegido: el servidor lo fija, no el navegador', async () => {
  llamadas = []; iaRespuesta = IA;
  await post({ application_id: APP, modelo: 'sonnet' }, 'owner');
  const ia = llamadas.find(l => l.url.startsWith('https://api.anthropic.com'));
  assert.equal(JSON.parse(ia.body).model, 'claude-sonnet-5-5');
  assert.equal('temperature' in JSON.parse(ia.body), false, 'los modelos nuevos no aceptan temperature');
  assert.deepEqual(JSON.parse(ia.body).thinking, { type: 'between_tools' }, 'así se apaga el razonamiento previo en estos modelos (gastaba el cupo de salida)');
});

test('CV ilegible: 400 claro y no se gasta IA', async () => {
  llamadas = []; const antes = cvTexto; cvTexto = '';
  const r = await post({ application_id: APP }, 'owner');
  cvTexto = antes;
  assert.equal(r.status, 400); assert.match((await r.json()).error, /CV/);
  assert.equal(llamadas.filter(l => l.url.startsWith('https://api.anthropic.com')).length, 0);
});

test('la IA inventa una cita: el criterio queda sin dato y el chequeo lo marca', async () => {
  llamadas = []; iaRespuesta = { ...IA, criterios: [{ n: 1, veredicto: 'cumple', cita: 'dirigió 40 países desde Miami durante diez años', fuente: 'notas' }, IA.criterios[1]] };
  const j = await (await post({ application_id: APP }, 'owner')).json();
  assert.equal(j.informe.ranking.criterios[0].veredicto, 'sin_dato');
  assert.equal(j.informe.qa.find(q => q.clave === 'con_evidencia').ok, false);
  assert.equal(j.informe.ranking.puntaje, 100, 'solo cuenta lo comprobado');
});
