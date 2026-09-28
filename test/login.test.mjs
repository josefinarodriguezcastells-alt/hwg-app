// api/login.js: control de acceso + límite de intentos. Supabase está
// mockeado (users y login_attempts como arrays en memoria, con los mismos
// filtros eq./gte. que usa PostgREST); nunca se toca la base real ni se
// compara una contraseña de verdad.
//
// Correr con: npm test

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';

const REAL_HASH = bcrypt.hashSync('correcta123', 4);
const USERS = [
  { id: 'u1', email: 'recruiter@hwgtalent.com', name: 'Rec Uno', role: 'recruiter', password: REAL_HASH },
  // Email real con mayúsculas de mitad de palabra — el lookup de `users`
  // tiene que seguir siendo case-sensitive como antes (no normalizar acá),
  // o esta cuenta se queda sin poder loguearse nunca más.
  { id: 'u2', email: 'Majulcarlaa@gmail.com', name: 'Carla Majul', role: 'recruiter', password: REAL_HASH },
];

let attempts, forceAttemptsQueryFail;
beforeEach(() => { attempts = []; forceAttemptsQueryFail = false; });

const q = (url, key) => new URL(url).searchParams.get(key);
const eq = (url, key) => (q(url, key) || '').replace(/^eq\./, '');
const gte = (url, key) => (q(url, key) || '').replace(/^gte\./, '');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const table = new URL(url).pathname.split('/').pop();

  if (table === 'users') {
    const wanted = eq(url, 'email');
    return json(USERS.filter(u => u.email === wanted));
  }
  if (table === 'login_attempts') {
    if (opts.method === 'POST') {
      const rows = JSON.parse(opts.body);
      attempts.push(...rows.map(r => ({ ...r, created_at: new Date().toISOString() })));
      return json([], 201);
    }
    if (forceAttemptsQueryFail) return json({ message: 'fallo' }, 500);
    const wantedEmail = eq(url, 'email');
    const since = gte(url, 'created_at');
    return json(attempts.filter(a => a.email === wantedEmail && a.created_at >= since));
  }
  throw new Error('tabla no mockeada: ' + table);
};

let server, base;
before(async () => {
  const handler = require('../api/login.js');
  server = http.createServer(async (req, res) => {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    let raw = ''; for await (const c of req) raw += c;
    req.body = raw ? JSON.parse(raw) : {};
    await handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function post(body) {
  const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('preflight', async () => {
  const r = await fetch(base, { method: 'OPTIONS' });
  assert.equal(r.status, 200);
});

test('credenciales correctas → 200 con token, sin registrar intento', async () => {
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.password, undefined);
  assert.equal(attempts.length, 0);
});

test('contraseña incorrecta → 401 y registra un intento fallido', async () => {
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  assert.equal(r.status, 401);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].email, 'recruiter@hwgtalent.com');
});

test('usuario inexistente → 401 y registra un intento fallido (mismo mensaje que contraseña incorrecta)', async () => {
  const r1 = await post({ email: 'nadie@hwgtalent.com', password: 'x' });
  const r2 = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error, r2.body.error);
  assert.equal(attempts.length, 2);
});

test('5 intentos fallidos → el 6to da 429 sin llegar a comparar la contraseña (aunque sea la correcta)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
    assert.equal(r.status, 401);
  }
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Demasiados intentos/);
  // No se sumó un 6to intento fallido: el corte pasó antes de tocar users.
  assert.equal(attempts.length, 5);
});

test('el límite es por email — otro usuario no se ve afectado', async () => {
  for (let i = 0; i < 5; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  const r = await post({ email: 'Majulcarlaa@gmail.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('el email de mayúsculas de mitad de palabra sigue pudiendo loguearse (no se normaliza el lookup a users)', async () => {
  const r = await post({ email: 'Majulcarlaa@gmail.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email, 'Majulcarlaa@gmail.com');
});

test('el conteo de intentos no distingue mayúsculas en el email (para que no se esquive el límite)', async () => {
  for (let i = 0; i < 3; i++) await post({ email: 'Recruiter@HWGTalent.com', password: 'mala' });
  for (let i = 0; i < 3; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  // Si contara distinto, ninguno de los dos llegaría a 5. Juntos ya son 6.
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 429);
});

test('sin email o sin contraseña → 400, no cuenta como intento', async () => {
  const r1 = await post({ email: 'recruiter@hwgtalent.com' });
  const r2 = await post({ password: 'x' });
  assert.equal(r1.status, 400);
  assert.equal(r2.status, 400);
  assert.equal(attempts.length, 0);
});

test('si falla la consulta de intentos, el login sigue intentando en vez de bloquear a todos', async () => {
  forceAttemptsQueryFail = true;
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
