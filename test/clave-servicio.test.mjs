// api/_supabase.js: la clave de servicio en sus dos formatos y la variable V2 para rotar sin cortar nada.
// Correr con: npm test

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { claveServicio, cabecerasServicio } = require('../api/_supabase.js');
const jwt = require('jsonwebtoken');

const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma';
const NUEVA = 'sb_secret_abc123';
let guardado;
beforeEach(() => { guardado = { a: process.env.SUPABASE_SERVICE_KEY, b: process.env.SUPABASE_SERVICE_KEY_V2, c: process.env.SUPABASE_URL, d: process.env.SESSION_SECRET }; delete process.env.SUPABASE_SERVICE_KEY_V2; });
afterEach(() => {
  for (const [k, v] of [['SUPABASE_SERVICE_KEY', guardado.a], ['SUPABASE_SERVICE_KEY_V2', guardado.b], ['SUPABASE_URL', guardado.c], ['SESSION_SECRET', guardado.d]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('clave legacy (JWT): va en apikey y como Bearer', () => {
  process.env.SUPABASE_SERVICE_KEY = LEGACY;
  assert.deepEqual(cabecerasServicio(), { apikey: LEGACY, Authorization: 'Bearer ' + LEGACY });
});
test('clave secreta nueva: solo en apikey, nunca como Bearer (Supabase la rechaza)', () => {
  process.env.SUPABASE_SERVICE_KEY = NUEVA;
  const h = cabecerasServicio({ 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  assert.deepEqual(h, { apikey: NUEVA, 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  assert.ok(!('Authorization' in h));
});
test('SUPABASE_SERVICE_KEY_V2 tiene prioridad; al borrarla se vuelve a la vieja', () => {
  process.env.SUPABASE_SERVICE_KEY = LEGACY; process.env.SUPABASE_SERVICE_KEY_V2 = NUEVA;
  assert.equal(claveServicio(), NUEVA); assert.ok(!cabecerasServicio().Authorization);
  delete process.env.SUPABASE_SERVICE_KEY_V2;
  assert.equal(claveServicio(), LEGACY); assert.ok(cabecerasServicio().Authorization);
});
test('sin ninguna clave devuelve undefined (los endpoints responden 500 de configuración)', () => {
  delete process.env.SUPABASE_SERVICE_KEY;
  assert.equal(claveServicio(), undefined);
});

test('de punta a punta: db.js con la clave nueva manda solo apikey a Supabase; con la vieja manda las dos', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SESSION_SECRET = 'test-secret';
  const handler = require('../api/db.js');
  const realFetch = globalThis.fetch; const vistos = [];
  globalThis.fetch = async (url, opts = {}) => { url = String(url); if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts); vistos.push(opts.headers); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const srv = await new Promise((r) => { const s = http.createServer(async (req, res) => { res.status = (c) => { res.statusCode = c; return res; }; res.json = (o) => { res.end(JSON.stringify(o)); return res; }; req.body = undefined; await handler(req, res); }).listen(0, '127.0.0.1', () => r(s)); });
  const tok = jwt.sign({ id: 'u1', email: 'o@x', role: 'owner' }, 'test-secret');
  try {
    for (const [clave, conBearer] of [[NUEVA, false], [LEGACY, true]]) {
      process.env.SUPABASE_SERVICE_KEY = clave; vistos.length = 0;
      const r = await realFetch(`http://127.0.0.1:${srv.address().port}/?__t=candidates&select=id`, { headers: { Authorization: 'Bearer ' + tok } });
      assert.equal(r.status, 200);
      assert.equal(vistos[0].apikey, clave); assert.equal('Authorization' in vistos[0], conBearer);
    }
  } finally { globalThis.fetch = realFetch; srv.close(); }
});
