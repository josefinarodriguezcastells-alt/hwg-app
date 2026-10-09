// Scorecard automático (lado servidor): qué se le manda a la IA y qué se
// acepta de vuelta. La IA está mockeada: nunca se llama de verdad.
// Correr con: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const {
  MAX_NOTAS, recortarNotas, resumirCriterios, construirPrompt, limpiarPrefill,
} = require('../api/_scorecardPrompt.js');

process.env.SESSION_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'sk-fake';
const realFetch = globalThis.fetch;
let aiBodies = [];
let aiReply = {};
let aiStop = 'end_turn';
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (url.startsWith('https://api.anthropic.com')) {
    aiBodies.push(JSON.parse(opts.body));
    const text = typeof aiReply === 'string' ? aiReply : JSON.stringify(aiReply);
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: aiStop }), { status: 200 });
  }
  throw new Error('fetch no mockeado: ' + url);
};

const PREGUNTAS = [
  { id: 'q_ingles', label: 'Nivel de inglés', tipo: 'escala' },
  { id: 'q_remoto', label: '¿Acepta remoto?', tipo: 'si_no' },
  { id: 'q_motivo', label: 'Motivo del cambio', tipo: 'texto' },
  { id: 'q_modalidad', label: 'Modalidad', tipo: 'opciones', opciones: ['Remoto', 'Híbrido'] },
];

test('las notas largas entran completas hasta el tope (antes se cortaban en 6.000)', () => {
  const notas = 'a'.repeat(5999) + ' PEDIDO-DE-SUELDO-USD-4000 ' + 'b'.repeat(8000);
  const { userText, recortado } = construirPrompt({ transcripcion: notas, preguntas: PREGUNTAS });
  assert.equal(recortado, false);
  assert.ok(userText.includes('PEDIDO-DE-SUELDO-USD-4000'));
  assert.ok(MAX_NOTAS >= 30000);
});

test('si las notas pasan el tope se corta el medio y se conservan principio y final', () => {
  const notas = 'INICIO-' + 'x'.repeat(MAX_NOTAS * 2) + '-FINAL';
  const r = recortarNotas(notas);
  assert.equal(r.recortado, true);
  assert.ok(r.texto.startsWith('INICIO-') && r.texto.endsWith('-FINAL'));
  assert.ok(r.texto.length < MAX_NOTAS + 100);
});

test('sin notas: el pedido dice que no se invente lo que depende de haber hablado', () => {
  const { system, userText } = construirPrompt({ transcripcion: '', preguntas: PREGUNTAS });
  assert.match(system, /No hay entrevista todavía/);
  assert.ok(!userText.includes('NOTAS / TRANSCRIPCIÓN'));
});

test('el pedido incluye la regla de no inventar y el campo no_se_hablo', () => {
  const { system } = construirPrompt({ transcripcion: 'algo', preguntas: PREGUNTAS });
  assert.match(system, /nunca inventes/i);
  assert.match(system, /"no_se_hablo"/);
  assert.match(system, /calculados con las fechas del CV/);
});

test('la JD estructurada aporta criterios y ajustes, con topes', () => {
  const criterios = Array.from({ length: 20 }, (_, i) => ({ texto: 'criterio ' + i, tipo: i === 0 ? 'excluyente' : 'deseable', importancia: 'alta' }));
  const calibraciones = Array.from({ length: 10 }, (_, i) => ({ texto: 'ajuste ' + i }));
  const r = resumirCriterios({ criterios, calibraciones });
  assert.equal(r.criterios.length, 12);
  assert.equal(r.calibraciones.length, 6);
  assert.match(r.criterios[0], /excluyente/);
  const { userText } = construirPrompt({ transcripcion: 'x', preguntas: PREGUNTAS, jdEstructurada: { criterios, calibraciones } });
  assert.ok(userText.includes('LO QUE PIDE LA POSICIÓN') && userText.includes('AJUSTES RECIENTES'));
});

test('sin JD estructurada el pedido sale igual, sin esas secciones', () => {
  const { userText } = construirPrompt({ transcripcion: 'x', preguntas: PREGUNTAS, jdEstructurada: null });
  assert.ok(!userText.includes('LO QUE PIDE LA POSICIÓN'));
});

test('limpiarPrefill: descarta preguntas inexistentes y valores inválidos, y anota lo que no se habló', () => {
  const r = limpiarPrefill({
    nombre_apellido: ' Ana Pérez ',
    anios_experiencia: '6 años (2019–2025)',
    respuestas: { q_ingles: '9', q_remoto: 'tal vez', q_motivo: 'Busca crecer', q_modalidad: 'Presencial', q_fantasma: 'x' },
    no_se_hablo: ['q_remoto', 'q_fantasma', 'q_motivo'],
    fit_cultural_pills: ['startup', 'inventada'],
  }, PREGUNTAS);
  assert.equal(r.nombre_apellido, 'Ana Pérez');
  assert.deepEqual(r.respuestas, { q_motivo: 'Busca crecer' });
  assert.deepEqual(r.no_se_hablo, ['q_remoto']);
  assert.deepEqual(r.fit_cultural_pills, ['startup']);
});

test('limpiarPrefill: aguanta basura sin romperse', () => {
  assert.deepEqual(limpiarPrefill(null, PREGUNTAS).respuestas, {});
  assert.deepEqual(limpiarPrefill({ respuestas: 'hola', no_se_hablo: 5 }, PREGUNTAS).no_se_hablo, []);
});

// ── endpoint completo, con la IA simulada ──
let server, base;
before(async () => {
  const m = await import(new URL('../api/scorecard-prefill.js', import.meta.url));
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

const post = (body, auth = true) => realFetch(base, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + jwt.sign({ id: 'u1', email: 'x@example.com', role: 'recruiter' }, 'test-secret') } : {}) },
  body: JSON.stringify(body),
});

test('endpoint: sin sesión rechaza y no llama a la IA', async () => {
  aiBodies = [];
  const r = await post({ preguntas: PREGUNTAS }, false);
  assert.equal(r.status, 401);
  assert.equal(aiBodies.length, 0);
});

test('endpoint: una sola llamada a la IA, con tope de respuesta y resultado limpio', async () => {
  aiBodies = []; aiStop = 'end_turn';
  aiReply = { nombre_apellido: 'Ana', respuestas: { q_ingles: '4', q_basura: 'x' }, no_se_hablo: ['q_remoto'] };
  const r = await post({ candidateName: 'Ana', positionRole: 'Dev', preguntas: PREGUNTAS, transcripcion: 'notas de la entrevista', jdEstructurada: { criterios: [{ texto: 'Java', tipo: 'excluyente', importancia: 'alta' }] } });
  const j = await r.json();
  assert.equal(aiBodies.length, 1);
  assert.equal(aiBodies[0].max_tokens, 3000);
  assert.ok(aiBodies[0].messages[0].content[0].text.includes('notas de la entrevista'));
  assert.ok(aiBodies[0].messages[0].content[0].text.includes('Java'));
  assert.equal(j.ok, true);
  assert.deepEqual(j.prefill.respuestas, { q_ingles: '4' });
  assert.deepEqual(j.prefill.no_se_hablo, ['q_remoto']);
});

test('endpoint: respuesta cortada o ilegible de la IA da un error claro, no un cuelgue', async () => {
  aiStop = 'max_tokens'; aiReply = { nombre_apellido: 'Ana' };
  let r = await post({ preguntas: PREGUNTAS, transcripcion: 'x' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /cortada/);
  aiStop = 'end_turn'; aiReply = 'esto no es json';
  r = await post({ preguntas: PREGUNTAS, transcripcion: 'x' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /no se pudo leer/);
});
