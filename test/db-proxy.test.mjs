// api/db.js + api/_db-policy.js: el proxy autenticado hacia PostgREST.
// Supabase mockeado: se captura el pedido que saldría hacia la base para
// verificar qué se reenvía, con qué clave y qué se bloquea ANTES de llegar.
//
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

const { validarSelect } = require('../api/_db-policy.js');
const ses = (role, id = 'u1') => jwt.sign({ id, email: `${role}@hwgtalent.com`, role }, 'test-secret');
const OWNER = ses('owner'), RECRUITER = ses('recruiter', 'u2'), CLIENTE = ses('client', 'u3');

let llamadas, respuesta;
beforeEach(() => { llamadas = []; respuesta = { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ id: 1 }]) }; });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  llamadas.push({ url, method: (opts.method || 'GET').toUpperCase(), headers: opts.headers || {}, body: opts.body });
  return new Response(respuesta.status === 204 ? null : respuesta.body, { status: respuesta.status, headers: respuesta.headers });
};

let srv;
before(async () => {
  const handler = require('../api/db.js');
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
const call = (qs, { method = 'GET', token = OWNER, body, headers = {} } = {}) => realFetch(`${srv.url}/?${qs}`, {
  method, body: body !== undefined ? JSON.stringify(body) : undefined,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
});

// ── validarSelect ─────────────────────────────────────────────────────────
test('validarSelect: acepta los selects reales de la app (incrustados, !inner, users(name))', () => {
  for (const s of ['*', 'id,name', '*, candidates(*), users(name)', 'id, applications!inner(recruiter_id)', '*, users!lead_owner_id(name)',
    '*, clients(name,stakeholder), applications(status), position_recruiters(recruiter_id, users(name))',
    'id,status,candidates(id,name),positions(clients(name,id))', 'id, x:candidates(name)']) {
    assert.equal(validarSelect(s), null, s);
  }
});
test('validarSelect: bloquea incrustar facturación, PINs, contactos y contraseñas', () => {
  for (const s of ['*, billing(*)', 'id, client_secrets(portal_pin)', 'id, x:billing(fee_cliente_monto)', '*, facturas(*)', '*, lead_contacts(*)',
    '*, finanzas_log(*)', '*, app_settings(*)', '*, users(password)', '*, users(*)', 'id, users(name, users(id))', '*, users()', 'id, (name)', 'id, candidates(name']) {
    assert.notEqual(validarSelect(s), null, s);
  }
});

// ── acceso ────────────────────────────────────────────────────────────────
test('sin sesión → 401; rol cliente → 403; sin tocar la base', async () => {
  assert.equal((await call('__t=candidates&select=*', { token: null })).status, 401);
  assert.equal((await call('__t=candidates&select=*', { token: CLIENTE })).status, 403);
  assert.equal(llamadas.length, 0);
});
test('tabla no permitida (billing, users, tablas bloqueadas) → 400 sin llegar a la base', async () => {
  for (const t of ['billing', 'users', 'facturas', 'client_secrets', 'lead_contacts', 'app_settings', 'login_attempts', '', 'candidates;drop']) {
    assert.equal((await call(`__t=${encodeURIComponent(t)}&select=*`)).status, 400, t);
  }
  assert.equal(llamadas.length, 0);
});
test('un select que incrusta una tabla bloqueada → 400 aunque la tabla pedida sea válida', async () => {
  for (const sel of ['*,billing(*)', '*,users(password)', 'id,client_secrets(portal_pin)']) {
    assert.equal((await call(`__t=applications&select=${encodeURIComponent(sel)}`)).status, 400, sel);
  }
  assert.equal((await call('__t=applications&select=*&order=billing(fee)')).status, 400);
  assert.equal(llamadas.length, 0);
});

// ── reenvío ───────────────────────────────────────────────────────────────
test('reenvía filtros, orden, límite y parámetros repetidos tal cual, con la clave de servicio (no la sesión)', async () => {
  const r = await call('__t=candidates&select=id,name&created_at=gte.2026-01-01&created_at=lt.2026-12-01&order=created_at.desc&limit=5');
  assert.equal(r.status, 200);
  const l = llamadas[0];
  assert.equal(l.method, 'GET');
  const u = new URL(l.url);
  assert.equal(u.pathname, '/rest/v1/candidates');
  assert.equal(u.searchParams.get('select'), 'id,name');
  assert.deepEqual(u.searchParams.getAll('created_at'), ['gte.2026-01-01', 'lt.2026-12-01']);
  assert.equal(u.searchParams.get('order'), 'created_at.desc');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.equal(u.searchParams.has('__t'), false, 'el parámetro propio del proxy no sale');
  assert.equal(l.headers.apikey, 'svc-fake');
  assert.equal(l.headers.Authorization, 'Bearer svc-fake');
});
test('reenvía Prefer, Range y Accept (single, conteos, return=representation)', async () => {
  await call('__t=applications&select=*', { headers: { Prefer: 'count=exact', Range: '0-9', 'Range-Unit': 'items', Accept: 'application/vnd.pgrst.object+json' } });
  const h = llamadas[0].headers;
  assert.equal(h.prefer, 'count=exact'); assert.equal(h.range, '0-9'); assert.equal(h['range-unit'], 'items');
  assert.equal(h.accept, 'application/vnd.pgrst.object+json');
});
test('devuelve Content-Range (los conteos de la app dependen de eso) y el estado de la base', async () => {
  respuesta = { status: 206, headers: { 'content-type': 'application/json', 'content-range': '0-0/2483' }, body: '[]' };
  const r = await call('__t=candidates&select=id', { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), '0-0/2483');
  assert.equal(llamadas[0].method, 'HEAD');
});
test('POST/PATCH reenvían el cuerpo; DELETE 204 sin cuerpo; los errores de la base se devuelven tal cual', async () => {
  await call('__t=candidates', { method: 'POST', body: [{ name: 'X' }], headers: { Prefer: 'return=representation' } });
  assert.equal(llamadas[0].method, 'POST'); assert.equal(JSON.parse(llamadas[0].body)[0].name, 'X'); assert.equal(llamadas[0].headers.prefer, 'return=representation');
  await call('__t=candidates&id=eq.1', { method: 'PATCH', body: { name: 'Y' } });
  assert.equal(JSON.parse(llamadas[1].body).name, 'Y');
  respuesta = { status: 204, headers: {}, body: '' };
  assert.equal((await call('__t=candidates&id=eq.1', { method: 'DELETE' })).status, 204);
  respuesta = { status: 409, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '23505', message: 'duplicado' }) };
  const r = await call('__t=candidates', { method: 'POST', body: [{ name: 'X' }] });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, '23505');
});
test('el preflight CORS permite Prefer y Range y expone Content-Range', async () => {
  const r = await realFetch(`${srv.url}/?__t=candidates`, { method: 'OPTIONS' });
  const ok = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
  // Las cabeceras que manda de verdad supabase-js (Accept-Profile / Content-Profile
  // las agrega siempre postgrest-js: sin permitirlas el navegador bloquea TODOS
  // los pedidos con "estado 0") — hwg_ats/tests/db-proxy-cliente.test.mjs
  // verifica que esta lista cubra lo que la librería manda.
  for (const h of ['authorization', 'prefer', 'range', 'range-unit', 'accept', 'accept-profile', 'content-profile', 'x-client-info', 'x-supabase-api-version', 'content-type']) assert.ok(ok.includes(h), h);
  assert.ok((r.headers.get('access-control-expose-headers') || '').toLowerCase().includes('content-range'));
});

// ── roles ─────────────────────────────────────────────────────────────────
test('recruiter: lee clientes pero SOLO no-leads (se agrega is_lead=eq.false) y no puede escribirlos', async () => {
  await call('__t=clients&select=*', { token: RECRUITER });
  assert.equal(new URL(llamadas[0].url).searchParams.get('is_lead'), 'eq.false');
  assert.equal((await call('__t=clients&id=eq.1', { method: 'PATCH', token: RECRUITER, body: { name: 'X' } })).status, 403);
  assert.equal((await call('__t=clients', { method: 'POST', token: RECRUITER, body: [{ name: 'X' }] })).status, 403);
  assert.equal((await call('__t=clients&id=eq.1', { method: 'DELETE', token: RECRUITER })).status, 403);
  assert.equal(llamadas.length, 1, 'las escrituras bloqueadas no llegaron a la base');
});
test('un recruiter no puede esquivar el filtro de leads mandando el suyo', async () => {
  await call('__t=clients&select=*&is_lead=eq.true', { token: RECRUITER });
  assert.equal(new URL(llamadas[0].url).searchParams.get('is_lead'), 'eq.false');
});
test('owner: lee todo (leads incluidos) y escribe clientes', async () => {
  await call('__t=clients&select=*');
  assert.equal(new URL(llamadas[0].url).searchParams.has('is_lead'), false);
  assert.equal((await call('__t=clients&id=eq.1', { method: 'PATCH', body: { name: 'X' } })).status, 200);
});
test('recruiter: escribe candidatos, postulaciones y scorecards (como hoy)', async () => {
  for (const t of ['candidates', 'applications', 'scorecards', 'positions', 'candidate_documents']) {
    assert.equal((await call(`__t=${t}&id=eq.1`, { method: 'PATCH', token: RECRUITER, body: { notes: 'x' } })).status, 200, t);
  }
});
