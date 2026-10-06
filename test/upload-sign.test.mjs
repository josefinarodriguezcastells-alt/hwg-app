// api/upload-sign.js: permiso de subida firmado para el bucket 'candidates'.
// Correr con: npm test

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';
const { pathValido } = require('../api/upload-sign.js');
const ses = (role) => jwt.sign({ id: 'u1', email: `${role}@hwgtalent.com`, role }, 'test-secret');

let llamadas, respuesta;
beforeEach(() => { llamadas = []; respuesta = { status: 200, body: { url: '/object/upload/sign/candidates/x?token=TOK123' } }; });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/storage/v1/')) throw new Error('fetch no mockeado: ' + url);
  llamadas.push({ url, method: opts.method, headers: opts.headers });
  return new Response(JSON.stringify(respuesta.body), { status: respuesta.status, headers: { 'content-type': 'application/json' } });
};

let srv;
before(async () => {
  const handler = require('../api/upload-sign.js');
  srv = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      let raw = ''; for await (const c of req) raw += c;
      req.body = raw ? JSON.parse(raw) : undefined;
      await handler(req, res);
    }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
});
after(() => srv.s.close());
const call = (body, token = ses('recruiter'), method = 'POST') => realFetch(srv.url, {
  method, body: body !== undefined ? JSON.stringify(body) : undefined,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
});
const UUID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';

test('pathValido: acepta los paths que arma el ATS', () => {
  for (const p of ['cvs/1759760000000.pdf', `${UUID}/cv_1759760000000.docx`, `${UUID}/interview_notes_1759760000000.PDF`, `${UUID}/certificate_1759760000000.png`, `${UUID}/cover_letter_1759760000000.pdf`]) assert.ok(pathValido(p), p);
});
test('pathValido: rechaza escapes, otros prefijos, extensiones raras y tipos desconocidos', () => {
  for (const p of ['../x.pdf', 'cvs/../x.pdf', 'cvs/abc.pdf', 'otra/1759760000000.pdf', `${UUID}/../cv_1759760000000.pdf`, `${UUID}/malware_1759760000000.pdf`,
    `${UUID}/cv_1759760000000.p/df`, `${UUID}/cv_1759760000000.`, 'cvs/1759760000000.' + 'a'.repeat(30), '', null, undefined, 42, `${UUID}/cv_1759760000000.pdf/../../x`]) assert.ok(!pathValido(p), String(p));
});

test('sin sesión → 401; cliente → 403; sin tocar Storage', async () => {
  assert.equal((await call({ path: 'cvs/1759760000000.pdf' }, null)).status, 401);
  assert.equal((await call({ path: 'cvs/1759760000000.pdf' }, ses('client'))).status, 403);
  assert.equal(llamadas.length, 0);
});
test('método distinto de POST → 405', async () => {
  assert.equal((await call(undefined, ses('owner'), 'GET')).status, 405);
});
test('path inválido → 400 sin tocar Storage', async () => {
  const r = await call({ path: '../../etc/x.pdf' });
  assert.equal(r.status, 400); assert.equal(llamadas.length, 0);
  assert.equal((await call({})).status, 400);
});
test('recruiter y owner con path válido: pide el permiso a Storage con la clave de servicio y devuelve path+token', async () => {
  for (const rol of ['recruiter', 'owner']) {
    llamadas = [];
    const r = await call({ path: `${UUID}/cv_1759760000000.pdf` }, ses(rol));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { path: `${UUID}/cv_1759760000000.pdf`, token: 'TOK123' });
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url, `https://fake.supabase.co/storage/v1/object/upload/sign/candidates/${UUID}/cv_1759760000000.pdf`);
    assert.equal(llamadas[0].method, 'POST');
    assert.equal(llamadas[0].headers.Authorization, 'Bearer svc-fake');
  }
});
test('Storage falla o responde raro → 502, no filtra la clave', async () => {
  respuesta = { status: 400, body: { message: 'The resource already exists' } };
  const r = await call({ path: 'cvs/1759760000000.pdf' });
  assert.equal(r.status, 502); assert.ok(!JSON.stringify(await r.json()).includes('svc-fake'));
  respuesta = { status: 200, body: { url: '/object/upload/sign/candidates/x' } };
  assert.equal((await call({ path: 'cvs/1759760000000.pdf' })).status, 502);
});
