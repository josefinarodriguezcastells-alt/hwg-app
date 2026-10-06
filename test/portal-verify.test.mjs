// api/portal-verify.js: la pantalla del PIN del portal. PIN correcto → datos
// no sensibles del cliente + una sesión de portal; incorrecto → nada.
// Correr con: npm test

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { portalPinMock, reiniciarIntentos } from './_portal-pin-mock.mjs';

const require = createRequire(import.meta.url);
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';
const { verifyPortal } = require('../api/_auth.js');

const CLIENTS = [
  { id: 'c1', name: 'Acme', portal_token: 'TOK1', portal_pin: '1234', portal_active: true, cultural_tags: ['x'], portal_permissions: { cv: true } },
  { id: 'c2', name: 'Inactivo', portal_token: 'TOK2', portal_pin: '1234', portal_active: false },
];
beforeEach(() => reiniciarIntentos());
const realFetch = globalThis.fetch;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  const pm = portalPinMock(url, opts, CLIENTS); if (pm) return pm;
  const u = new URL(url);
  if (u.pathname.endsWith('/clients')) {
    const tok = (u.searchParams.get('portal_token') || '').replace(/^eq\./, ''), id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
    const filas = CLIENTS.filter((c) => (tok ? c.portal_token === tok : c.id === id) && (u.searchParams.get('portal_active') !== 'eq.true' || c.portal_active));
    return json(filas.map(({ id, name, cultural_tags, cultural_comment, portal_permissions }) => ({ id, name, cultural_tags, cultural_comment, portal_permissions })));
  }
  throw new Error('no mockeado: ' + url);
};

let srv;
before(async () => {
  const handler = require('../api/portal-verify.js');
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
const post = (body) => realFetch(srv.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('PIN correcto: datos no sensibles del cliente y una sesión de portal de ESE cliente', async () => {
  const r = await post({ portal_token: 'TOK1', portal_pin: '1234' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.client.name, 'Acme');
  assert.ok(!('portal_pin' in j.client) && !('portal_token' in j.client));
  assert.deepEqual(verifyPortal({ headers: { authorization: 'Bearer ' + j.session } }), { cid: 'c1' });
});
test('PIN incorrecto, portal inactivo o token inexistente: 403 y sin sesión', async () => {
  for (const b of [{ portal_token: 'TOK1', portal_pin: '0000' }, { portal_token: 'TOK2', portal_pin: '1234' }, { portal_token: 'NOPE', portal_pin: '1234' }]) {
    const r = await post(b);
    assert.equal(r.status, 403, JSON.stringify(b));
    assert.equal((await r.json()).session, undefined);
  }
});
test('el freno de intentos sigue: tras 10 PIN incorrectos, hasta el correcto da 429 y no entrega sesión', async () => {
  for (let i = 0; i < 10; i++) await post({ portal_token: 'TOK1', portal_pin: '0000' });
  const r = await post({ portal_token: 'TOK1', portal_pin: '1234' });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).session, undefined);
});
