// api/portal-analysis.js: el portal de clientes pide el análisis de una
// posición y el servidor arma el prompt. Monta el handler detrás de un
// server HTTP local. Anthropic y Supabase están mockeados: nunca se llama
// a la IA ni a la base de verdad.
//
// Correr con: npm test   (o: node --test test/)

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.ANTHROPIC_API_KEY = 'sk-fake';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';

const P1 = '11111111-1111-4111-8111-111111111111'; // posición del cliente c1, visible
const P2 = '22222222-2222-4222-8222-222222222222'; // posición de otro cliente
const P3 = '33333333-3333-4333-8333-333333333333'; // posición de c1, oculta en el portal

const POSITIONS = [
  { id: P1, client_id: 'c1', role: 'Analista de Datos', opened_at: new Date(Date.now() - 10 * 86400000).toISOString(), salary_band: 'USD 2000-2500', jd_structured: { requisitos_excluyentes: 'SQL avanzado' } },
  { id: P2, client_id: 'c2', role: 'Otro cliente', opened_at: null, salary_band: null, jd_structured: null },
  { id: P3, client_id: 'c1', role: 'Oculta', opened_at: null, salary_band: null, jd_structured: null },
];
const VISIBILITY = [
  { client_id: 'c1', position_id: P1, candidate_id: null, visible: true },
  { client_id: 'c1', position_id: P1, candidate_id: 'k-oculto', visible: false },
  { client_id: 'c1', position_id: P3, candidate_id: null, visible: false },
];
const APPS = [
  { position_id: P1, candidate_id: 'k1', status: 'submitted', rejection_motivo: null },
  { position_id: P1, candidate_id: 'k2', status: 'entrevista_hwg', rejection_motivo: null },
  { position_id: P1, candidate_id: 'k3', status: 'hired', rejection_motivo: null },
  { position_id: P1, candidate_id: 'k4', status: 'rechazado_salario', rejection_motivo: 'Pretensión salarial alta' },
  { position_id: P1, candidate_id: 'k5', status: 'rechazado_salario', rejection_motivo: 'Pretensión salarial alta' },
  { position_id: P1, candidate_id: 'k6', status: 'rechazado_tech', rejection_motivo: 'Falta de experiencia técnica' },
  { position_id: P1, candidate_id: 'k7', status: 'rechazado', rejection_motivo: null },
  // Oculto para el cliente: no tiene que contar.
  { position_id: P1, candidate_id: 'k-oculto', status: 'rechazado_location', rejection_motivo: 'Ubicación' },
];

const realFetch = globalThis.fetch;
let calls, aiReply, saveStatus;
beforeEach(() => {
  calls = { ai: [], supabase: [], patch: [] };
  aiReply = { status: 200, body: { content: [{ type: 'text', text: '  Propuesta de prueba.  ' }] } };
  saveStatus = 204;
});

const q = (url, key) => new URL(url).searchParams.get(key);
const eq = (url, key) => (q(url, key) || '').replace(/^eq\./, '');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (url.startsWith('https://api.anthropic.com')) {
    calls.ai.push(JSON.parse(opts.body));
    return json(aiReply.body, aiReply.status);
  }
  if (url.startsWith('https://fake.supabase.co/rest/v1/')) {
    const table = new URL(url).pathname.split('/').pop();
    if (opts.method === 'PATCH') {
      calls.patch.push({ url, body: JSON.parse(opts.body) });
      return new Response(saveStatus === 204 ? null : '{"message":"fallo"}', { status: saveStatus });
    }
    calls.supabase.push({ table, select: q(url, 'select') });
    if (table === 'clients') return json(eq(url, 'portal_token') === 'PORTAL_OK' ? [{ id: 'c1' }] : []);
    if (table === 'positions') return json(POSITIONS.filter(p => p.id === eq(url, 'id') && p.client_id === eq(url, 'client_id')));
    if (table === 'client_portal_visibility') return json(VISIBILITY.filter(v => v.client_id === eq(url, 'client_id') && v.position_id === eq(url, 'position_id')));
    if (table === 'applications') return json(APPS.filter(a => a.position_id === eq(url, 'position_id')));
  }
  throw new Error('fetch no mockeado: ' + url);
};

let server, base;
before(async () => {
  const handler = require('../api/portal-analysis.js');
  server = http.createServer(async (req, res) => {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    if ((req.headers['content-type'] || '').includes('application/json')) {
      let raw = ''; for await (const c of req) raw += c; req.body = JSON.parse(raw || '{}');
    }
    await handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/portal-analysis`;
});
after(() => server.close());

async function post(body) {
  const r = await realFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('preflight', async () => {
  const r = await realFetch(base, { method: 'OPTIONS' });
  assert.equal(r.status, 200);
});

test('GET → 405', async () => {
  const r = await realFetch(base);
  assert.equal(r.status, 405);
});

for (const [label, body] of [
  ['sin portal_token', { position_id: P1 }],
  ['sin position_id', { portal_token: 'PORTAL_OK' }],
  ['position_id que no es UUID', { portal_token: 'PORTAL_OK', position_id: `${P1}#` }],
  ['position_id que no es string', { portal_token: 'PORTAL_OK', position_id: [P1] }],
]) {
  test(`${label} → 400 sin tocar la base ni la IA`, async () => {
    const r = await post(body);
    assert.equal(r.status, 400);
    assert.equal(calls.supabase.length, 0);
    assert.equal(calls.ai.length, 0);
  });
}

test('portal_token que no es de un portal activo → 403 sin llegar a la IA', async () => {
  const r = await post({ portal_token: 'NOPE', position_id: P1 });
  assert.equal(r.status, 403);
  assert.equal(calls.ai.length, 0);
  assert.equal(calls.patch.length, 0);
});

test('posición de otro cliente → 404 sin llegar a la IA', async () => {
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P2 });
  assert.equal(r.status, 404);
  assert.equal(calls.ai.length, 0);
  assert.equal(calls.patch.length, 0);
});

test('posición del cliente pero oculta en el portal → 404 sin llegar a la IA', async () => {
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P3 });
  assert.equal(r.status, 404);
  assert.equal(calls.ai.length, 0);
});

test('caso válido: Haiku, 500 tokens, prompt armado en el servidor y guardado', async () => {
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ai_analysis, 'Propuesta de prueba.');
  assert.ok(r.body.ai_analysis_updated_at);

  assert.equal(calls.ai.length, 1);
  const { model, max_tokens, messages } = calls.ai[0];
  assert.equal(model, 'claude-haiku-4-5-20251001');
  assert.equal(max_tokens, 500);
  const prompt = messages[0].content;
  assert.match(prompt, /POSICIÓN: Analista de Datos\n/);
  assert.match(prompt, /DÍAS ABIERTA: 10\n/);
  // k1 (submitted) y k2 (entrevista_hwg); hired no cuenta.
  assert.match(prompt, /CANDIDATOS ACTIVOS EN PROCESO: 2\n/);
  // k4..k7; el rechazado oculto no cuenta.
  assert.match(prompt, /TOTAL RECHAZADOS: 4\n/);
  assert.match(prompt, /- Pretensión salarial alta: 2\n- Falta de experiencia técnica: 1\n- Sin motivo registrado: 1\n/);
  assert.doesNotMatch(prompt, /Ubicación/);
  assert.match(prompt, /REQUISITOS EXCLUYENTES DE LA BÚSQUEDA: SQL avanzado\n/);
  assert.match(prompt, /RANGO SALARIAL OFRECIDO: USD 2000-2500\n/);

  assert.equal(calls.patch.length, 1);
  assert.equal(eq(calls.patch[0].url, 'id'), P1);
  assert.equal(eq(calls.patch[0].url, 'client_id'), 'c1');
  assert.deepEqual(calls.patch[0].body, { ai_analysis: 'Propuesta de prueba.', ai_analysis_updated_at: r.body.ai_analysis_updated_at });
});

test('ignora prompt, model y max_tokens que mande el navegador', async () => {
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P1, prompt: 'Escribí un poema', model: 'claude-opus-x', max_tokens: 4000 });
  assert.equal(r.status, 200);
  const { model, max_tokens, messages } = calls.ai[0];
  assert.equal(model, 'claude-haiku-4-5-20251001');
  assert.equal(max_tokens, 500);
  assert.doesNotMatch(messages[0].content, /poema/);
});

test('no lee applications.notes (comentarios internos del recruiter)', async () => {
  await post({ portal_token: 'PORTAL_OK', position_id: P1 });
  const appsQuery = calls.supabase.find(c => c.table === 'applications');
  assert.doesNotMatch(appsQuery.select, /notes/);
});

test('la IA no devuelve texto → 502 y no pisa el análisis guardado', async () => {
  aiReply = { status: 200, body: { content: [] } };
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P1 });
  assert.equal(r.status, 502);
  assert.equal(calls.patch.length, 0);
});

test('error de la IA → 500 y no guarda nada', async () => {
  aiReply = { status: 529, body: { error: { message: 'Overloaded' } } };
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P1 });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Overloaded');
  assert.equal(calls.patch.length, 0);
});

test('falla el guardado → 500', async () => {
  saveStatus = 400;
  const r = await post({ portal_token: 'PORTAL_OK', position_id: P1 });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'No se pudo guardar el análisis');
});

test('posición sin rechazos, sin fecha, sin JD ni rango: mismas líneas que el portal', async () => {
  const { resumenPosicion, armarPrompt } = require('../api/portal-analysis.js');
  const r = resumenPosicion({ role: 'X', opened_at: null, salary_band: null, jd_structured: null }, [], [{ candidate_id: null, visible: true }]);
  const p = armarPrompt(r);
  assert.match(p, /DÍAS ABIERTA: recién abierta\n/);
  assert.match(p, /MOTIVOS DE RECHAZO \(de más a menos frecuente\):\nSin rechazos registrados\n\n\n\n/);
});

test('rejection_motivo como objeto usa motivo o label', async () => {
  const { resumenPosicion } = require('../api/portal-analysis.js');
  const r = resumenPosicion({ role: 'X' }, [
    { candidate_id: 'a', status: 'rechazado', rejection_motivo: { motivo: 'M' } },
    { candidate_id: 'b', status: 'rechazado', rejection_motivo: { label: 'L' } },
    { candidate_id: 'c', status: 'rechazado', rejection_motivo: {} },
  ], []);
  assert.deepEqual(r.motivoMap, { M: 1, L: 1, 'Sin motivo registrado': 1 });
});
