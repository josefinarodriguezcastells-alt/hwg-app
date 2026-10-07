// api/login.js: control de acceso + límite de intentos. Supabase está
// mockeado (users como array, login_attempts vía las dos funciones RPC que
// usa el endpoint — record_login_attempt/clear_login_attempts — con la
// misma semántica atómica que la función real de Postgres); nunca se toca
// la base real ni se compara una contraseña de verdad.
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
  // Email real con mayúsculas de mitad de palabra: tiene que poder entrar
  // escrito igual que está guardado y también en minúsculas.
  // Segunda cuenta con guion bajo: `_` es comodín de ilike y no debe colarse.
  { id: 'u2', email: 'Majulcarlaa@gmail.com', name: 'Carla Majul', role: 'recruiter', password: REAL_HASH },
  { id: 'u3', email: 'ana_b@hwgtalent.com', name: 'Ana', role: 'recruiter', password: REAL_HASH },
  { id: 'u4', email: 'anaxb@hwgtalent.com', name: 'Otra Ana', role: 'recruiter', password: bcrypt.hashSync('otra-clave', 4) },
];

// login_attempts en memoria, {email}|{ip} -> [timestamps]. record() imita la
// función de Postgres: inserta y devuelve el conteo en una sola operación
// (no hay ventana entre leer y guardar como en la primera versión).
let store, forceRecordFail;
const key = (email, ip) => `${email}|${ip}`;
beforeEach(() => { store = new Map(); forceRecordFail = false; });
function record(email, ip) {
  const k = key(email, ip);
  const arr = store.get(k) || [];
  arr.push(Date.now());
  store.set(k, arr);
  return arr.length;
}
function clear(email, ip) { store.delete(key(email, ip)); }

const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const path = new URL(url).pathname.replace('/rest/v1/', '');

  if (path === 'rpc/record_login_attempt') {
    if (forceRecordFail) return json({ message: 'fallo' }, 500);
    const { p_email, p_ip } = JSON.parse(opts.body);
    const recent_count = record(p_email, p_ip);
    return json([{ attempt_id: recent_count, recent_count }], 201);
  }
  if (path === 'rpc/clear_login_attempts') {
    const { p_email, p_ip } = JSON.parse(opts.body);
    clear(p_email, p_ip);
    return json([], 200);
  }
  if (path.startsWith('users')) {
    const param = new URL(url).searchParams.get('email');
    if (param.startsWith('ilike.')) {
      // Como ilike de Postgres: sin distinguir mayúsculas, `_` y `%` son comodines.
      const re = new RegExp('^' + param.slice(6).replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$', 'i');
      return json(USERS.filter(u => re.test(u.email)));
    }
    const wanted = param.replace(/^eq\./, '');
    return json(USERS.filter(u => u.email === wanted));
  }
  throw new Error('ruta no mockeada: ' + path);
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

async function post(body, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['x-forwarded-for'] = ip;
  const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('preflight', async () => {
  const r = await fetch(base, { method: 'OPTIONS' });
  assert.equal(r.status, 200);
});

test('credenciales correctas → 200 con token, y libera el contador de intentos', async () => {
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.password, undefined);
  assert.equal(store.get(key('recruiter@hwgtalent.com', 'sin-ip')), undefined);
});

test('contraseña incorrecta → 401 y queda contado', async () => {
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  assert.equal(r.status, 401);
  assert.equal(store.get(key('recruiter@hwgtalent.com', 'sin-ip')).length, 1);
});

test('usuario inexistente → 401 y queda contado (mismo mensaje que contraseña incorrecta)', async () => {
  const r1 = await post({ email: 'nadie@hwgtalent.com', password: 'x' });
  const r2 = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error, r2.body.error);
  assert.equal(store.get(key('nadie@hwgtalent.com', 'sin-ip')).length, 1);
  assert.equal(store.get(key('recruiter@hwgtalent.com', 'sin-ip')).length, 1);
});

test('5 intentos fallidos → el 6to da 429 sin llegar a comparar la contraseña (aunque sea la correcta)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
    assert.equal(r.status, 401);
  }
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Demasiados intentos/);
});

test('el límite es por email — otro usuario no se ve afectado', async () => {
  for (let i = 0; i < 5; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  const r = await post({ email: 'Majulcarlaa@gmail.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('el email de mayúsculas de mitad de palabra entra escrito igual que está guardado', async () => {
  const r = await post({ email: 'Majulcarlaa@gmail.com', password: 'correcta123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email, 'Majulcarlaa@gmail.com');
});

test('el login no distingue mayúsculas ni espacios en el email (el caso de Carla)', async () => {
  for (const e of ['majulcarlaa@gmail.com', 'MAJULCARLAA@GMAIL.COM', '  Majulcarlaa@Gmail.com ']) {
    const r = await post({ email: e, password: 'correcta123' });
    assert.equal(r.status, 200, e + ' ' + JSON.stringify(r.body));
    assert.equal(r.body.email, 'Majulcarlaa@gmail.com');
  }
});

test('mayúsculas distintas con contraseña mala siguen dando 401', async () => {
  const r = await post({ email: 'MAJULCARLAA@gmail.com', password: 'mala' });
  assert.equal(r.status, 401);
});

test('el guion bajo del email no funciona como comodín: no entra a la cuenta equivocada', async () => {
  const bien = await post({ email: 'ana_b@hwgtalent.com', password: 'correcta123' });
  assert.equal(bien.status, 200);
  assert.equal(bien.body.id, 'u3');
  // 'anaxb' existe con otra clave: pedir ana_b con la clave de anaxb no sirve.
  const cruzado = await post({ email: 'ana_b@hwgtalent.com', password: 'otra-clave' });
  assert.equal(cruzado.status, 401);
  const otra = await post({ email: 'anaxb@hwgtalent.com', password: 'otra-clave' });
  assert.equal(otra.body.id, 'u4');
});

test('un % en el email no sirve para recorrer cuentas', async () => {
  const r = await post({ email: '%@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 401);
});

test('el conteo de intentos no distingue mayúsculas en el email (para que no se esquive el límite)', async () => {
  for (let i = 0; i < 3; i++) await post({ email: 'Recruiter@HWGTalent.com', password: 'mala' });
  for (let i = 0; i < 3; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' });
  // Si contara distinto, ninguno de los dos llegaría a 5. Juntos ya son 6.
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 429);
});

// Greptile P1: el límite era solo por email — cualquiera podía tirar 5
// contraseñas mal para el mail de OTRA persona y dejarla afuera. Ahora la
// clave es (email, ip).

test('un ataque contra el email desde UNA ip no bloquea a la cuenta entrando desde OTRA ip', async () => {
  for (let i = 0; i < 5; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' }, '1.2.3.4');
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' }, '9.9.9.9');
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('la misma ip sigue bloqueada tras 5 intentos, sin importar que después mande la contraseña correcta', async () => {
  for (let i = 0; i < 5; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' }, '1.2.3.4');
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' }, '1.2.3.4');
  assert.equal(r.status, 429);
});

test('x-forwarded-for con varias ips (cliente, proxy...) usa solo la primera', async () => {
  for (let i = 0; i < 5; i++) await post({ email: 'recruiter@hwgtalent.com', password: 'mala' }, '1.2.3.4, 10.0.0.1, 10.0.0.2');
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' }, '1.2.3.4');
  assert.equal(r.status, 429, 'tendría que reconocerla como la misma ip (la primera de la lista)');
});

test('sin email o sin contraseña → 400, no llega a reservar un intento', async () => {
  const r1 = await post({ email: 'recruiter@hwgtalent.com' });
  const r2 = await post({ password: 'x' });
  assert.equal(r1.status, 400);
  assert.equal(r2.status, 400);
  assert.equal(store.size, 0);
});

// Greptile P1: si record_login_attempt (el único freno) no se pudo correr,
// antes el login seguía sin ningún límite. Ahora falla cerrado.

test('si falla el registro del intento, el login se corta (falla cerrado) en vez de quedar sin límite', async () => {
  forceRecordFail = true;
  const r = await post({ email: 'recruiter@hwgtalent.com', password: 'correcta123' });
  assert.equal(r.status, 500);
});
