// Control de acceso de los endpoints que gastan IA (o procesan archivos).
// Monta cada handler detrás de un server HTTP local y le pega con fetch
// real (incluye multipart). Las llamadas salientes a Anthropic y Supabase
// están mockeadas: nunca se llama a la IA ni a la base de verdad.
//
// Correr con: npm test   (o: node --test test/)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const SECRET = 'test-secret';
process.env.SESSION_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = 'sk-fake';
process.env.AI_PROVIDER = 'claude';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';

const realFetch = globalThis.fetch;
let aiCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (url.startsWith('https://api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    aiCalls.push({ model: body.model, max_tokens: body.max_tokens });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 });
  }
  if (url.startsWith('https://fake.supabase.co/rest/v1/clients')) {
    const ok = url.includes('portal_token=eq.PORTAL_OK');
    return new Response(JSON.stringify(ok ? [{ id: 'c1' }] : []), { status: 200 });
  }
  throw new Error('fetch no mockeado: ' + url);
};

const NAMES = ['generate', 'analyze', 'extract-profile', 'scorecard-prefill', 'extract-text'];
const handlers = {};
let server, base;

before(async () => {
  for (const n of NAMES) {
    const m = await import(new URL(`../api/${n}.js`, import.meta.url));
    handlers[n] = m.default || m;
  }
  // Imita lo mínimo del runtime de Vercel: res.status/json y req.body para JSON.
  server = http.createServer(async (req, res) => {
    const name = req.url.split('/').pop();
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    if ((req.headers['content-type'] || '').includes('application/json')) {
      let raw = ''; for await (const c of req) raw += c; req.body = JSON.parse(raw || '{}');
    }
    await handlers[name](req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/`;
});
after(() => server.close());

const bearer = (role, secret = SECRET) => 'Bearer ' + jwt.sign({ id: 'u1', email: 'x@example.com', role }, secret);
const CV = () => new Blob(['Persona Inventada — inventada@example.com — Analista con 5 años de experiencia en SQL.'], { type: 'text/plain' });
const bodies = {
  generate: () => { const f = new FormData(); f.append('cv', CV(), 'cv.txt'); return f; },
  'extract-profile': () => { const f = new FormData(); f.append('cv', CV(), 'cv.txt'); return f; },
  'extract-text': () => { const f = new FormData(); f.append('file', CV(), 'cv.txt'); return f; },
  analyze: (extra = {}) => JSON.stringify({ prompt: 'p', model: 'claude-opus-x', max_tokens: 4000, ...extra }),
  'scorecard-prefill': () => JSON.stringify({ candidateName: 'X', preguntas: [{ id: 'q1', label: 'L', tipo: 'texto' }] }),
};
const USES_AI = ['generate', 'analyze', 'extract-profile', 'scorecard-prefill'];

async function post(name, { auth, body = bodies[name](), contentType } = {}) {
  const headers = {};
  if (typeof body === 'string') headers['Content-Type'] = contentType || 'application/json';
  else if (contentType) headers['Content-Type'] = contentType;
  if (auth) headers.Authorization = auth;
  aiCalls = [];
  const r = await realFetch(base + name, { method: 'POST', headers, body });
  const text = await r.text();
  return { status: r.status, text, aiCalls };
}

for (const name of NAMES) {
  test(`${name}: el preflight acepta Authorization`, async () => {
    const r = await realFetch(base + name, { method: 'OPTIONS' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
  });

  for (const [label, auth, status] of [
    ['token inválido', 'Bearer basura', 401],
    ['token firmado con otro secreto', bearer('owner', 'otro'), 401],
    ['"Bearer " vacío', 'Bearer ', 401],
    ['rol sin permiso', bearer('cliente'), 403],
  ]) {
    test(`${name}: ${label} → ${status} sin llegar a la IA`, async () => {
      const r = await post(name, { auth });
      assert.equal(r.status, status, r.text);
      assert.equal(r.aiCalls.length, 0);
    });
  }

  for (const role of ['owner', 'recruiter']) {
    test(`${name}: ${role} con sesión válida pasa`, async () => {
      const r = await post(name, { auth: bearer(role) });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.aiCalls.length, USES_AI.includes(name) ? 1 : 0);
    });
  }
}

// El chequeo va antes de parsear el multipart: un body roto con token
// inválido tiene que dar 401, no un error de parseo del archivo.
for (const name of ['generate', 'extract-profile', 'extract-text']) {
  test(`${name}: rechaza la sesión antes de parsear el multipart`, async () => {
    const r = await post(name, {
      auth: 'Bearer basura',
      body: 'esto no es multipart',
      contentType: 'multipart/form-data; boundary=nada',
    });
    assert.equal(r.status, 401, r.text);
  });
}

test('analyze: portal_token válido fija Haiku y 500 tokens', async () => {
  const r = await post('analyze', { body: bodies.analyze({ portal_token: 'PORTAL_OK' }) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.aiCalls, [{ model: 'claude-haiku-4-5-20251001', max_tokens: 500 }]);
});

test('analyze: portal_token válido no puede subir max_tokens pero sí bajarlo', async () => {
  const r = await post('analyze', { body: bodies.analyze({ portal_token: 'PORTAL_OK', max_tokens: 100 }) });
  assert.deepEqual(r.aiCalls, [{ model: 'claude-haiku-4-5-20251001', max_tokens: 100 }]);
});

test('analyze: portal_token que no es de un portal activo → 403 sin llegar a la IA', async () => {
  const r = await post('analyze', { body: bodies.analyze({ portal_token: 'NOPE' }) });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.aiCalls.length, 0);
});

test('analyze: con sesión válida gana la sesión aunque venga portal_token', async () => {
  const r = await post('analyze', { auth: bearer('recruiter'), body: bodies.analyze({ portal_token: 'NOPE' }) });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.aiCalls, [{ model: 'claude-opus-x', max_tokens: 4000 }]);
});

// Paso 1 de 3: sin sesión todavía se deja pasar (el ATS en producción aún
// no la manda). Cuando se pase a exigirla, este test cambia a esperar 401.
for (const name of NAMES) {
  test(`${name}: sin sesión, por ahora, pasa (paso 1 de 3)`, async () => {
    const r = await post(name);
    assert.equal(r.status, 200, r.text);
  });
}
