// PIN de Finanzas en el servidor (api/finanzas-pin.js) + exigencia del token
// y registro de cambios en api/owner-data.js. Supabase mockeado (tablas en
// memoria); no se toca la base real.
//
// Correr con: npm test

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';
process.env.FINANZAS_PIN_ENFORCE = '1';

const { cambios, filasLogPatch } = require('../api/_finanzas.js');
const { hasFinanzasToken } = require('../api/_auth.js');

const sesion = (o = {}) => jwt.sign({ id: 'u-owner', email: 'josie@hwgtalent.com', role: 'owner', ...o }, 'test-secret');
const OWNER = sesion();
const OWNER2 = sesion({ id: 'u-owner2', email: 'sil@hwgtalent.com' });
const RECRUITER = sesion({ id: 'u-rec', email: 'rec@hwgtalent.com', role: 'recruiter' });

// ── Base en memoria ───────────────────────────────────────────────────────
let db, attempts, failLog;
const PIN_OK = '4321';
beforeEach(() => {
  db = {
    app_settings: [{ key: 'finanzas_pin_hash', value: bcrypt.hashSync(PIN_OK, 4) }],
    billing: [
      { id: 'b1', estado: 'facturado', fee_cliente_monto: 1000, recruiter_pagado: false, client_name: 'A' },
      { id: 'b2', estado: 'por_facturar', fee_cliente_monto: 500, recruiter_pagado: false, client_name: 'B' },
    ],
    facturas: [],
    finanzas_log: [],
  };
  attempts = new Map();
  failLog = false;
});

const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const u = new URL(url);
  const path = u.pathname.replace('/rest/v1/', '');
  const method = (opts.method || 'GET').toUpperCase();

  if (path === 'rpc/record_login_attempt') {
    const { p_email, p_ip } = JSON.parse(opts.body);
    const k = `${p_email}|${p_ip}`;
    attempts.set(k, (attempts.get(k) || 0) + 1);
    return json([{ attempt_id: 1, recent_count: attempts.get(k) }], 201);
  }
  if (path === 'rpc/clear_login_attempts') {
    const { p_email, p_ip } = JSON.parse(opts.body);
    attempts.delete(`${p_email}|${p_ip}`);
    return json([], 200);
  }

  const tabla = path;
  const rows = db[tabla];
  if (!rows) throw new Error('tabla no mockeada: ' + tabla);
  const filtros = [...u.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
  const match = (r) => filtros.every(([k, v]) => String(r[k]) === v.replace(/^eq\./, ''));

  if (method === 'GET') return json(rows.filter(match));
  if (method === 'POST') {
    if (tabla === 'finanzas_log' && failLog) return json({ message: 'log caído' }, 500);
    const nuevos = JSON.parse(opts.body).map((r, i) => ({ id: r.id || `${tabla}-${rows.length + i + 1}`, ...r }));
    rows.push(...nuevos);
    return json(nuevos, 201);
  }
  if (method === 'PATCH') {
    const body = JSON.parse(opts.body);
    const tocadas = rows.filter(match);
    tocadas.forEach((r) => Object.assign(r, body));
    return json(tocadas);
  }
  if (method === 'DELETE') {
    db[tabla] = rows.filter((r) => !match(r));
    return new Response(null, { status: 204 });
  }
  throw new Error('método no mockeado');
};

let server, base;
function levantar(handlerPath) {
  const handler = require(handlerPath);
  return new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      let raw = ''; for await (const c of req) raw += c;
      req.body = raw ? JSON.parse(raw) : {};
      const q = new URL(req.url, 'http://x').searchParams;
      req.query = Object.fromEntries([...new Set(q.keys())].map((k) => [k, q.getAll(k).length > 1 ? q.getAll(k) : q.get(k)]));
      await handler(req, res);
    }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
let pinSrv, dataSrv;
before(async () => {
  pinSrv = await levantar('../api/finanzas-pin.js');
  dataSrv = await levantar('../api/owner-data.js');
});
after(() => { pinSrv.s.close(); dataSrv.s.close(); });
const pin = (method, body, token = OWNER) => realFetch(pinSrv.url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
const data = (query, { method = 'GET', body, token = OWNER, fin } = {}) => realFetch(`${dataSrv.url}/?${query}`, {
  method, body: body !== undefined ? JSON.stringify(body) : undefined,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(fin ? { 'X-Finanzas-Token': fin } : {}) },
});
async function tokenFinanzas(t = OWNER) { const r = await pin('POST', { pin: PIN_OK }, t); return (await r.json()).token; }

// ── Lógica pura ───────────────────────────────────────────────────────────
test('cambios: solo lo que cambió de verdad; 5 y "5" y null y "" no cuentan', () => {
  const r = cambios({ estado: 'facturado', monto: 5, nota: null }, { estado: 'cobrado', monto: '5', nota: '', updated_at: 'x' });
  assert.deepEqual(r.antes, { estado: 'facturado' });
  assert.deepEqual(r.despues, { estado: 'cobrado' });
});
test('filasLogPatch: acción "estado" si cambió el estado, "editar" si no, nada si no cambió', () => {
  const u = { id: 'u1', email: 'a@b.c' };
  const f = [{ id: 1, estado: 'facturado', nota: 'x' }];
  assert.equal(filasLogPatch({ tabla: 'billing', filas: f, body: { estado: 'cobrado' }, usuario: u })[0].accion, 'estado');
  assert.equal(filasLogPatch({ tabla: 'billing', filas: f, body: { nota: 'y' }, usuario: u })[0].accion, 'editar');
  assert.deepEqual(filasLogPatch({ tabla: 'billing', filas: f, body: { estado: 'facturado' }, usuario: u }), []);
});
test('hasFinanzasToken: de la misma sesión sí; de otra sesión, vencido o con otro secreto no', () => {
  const ses = { id: 'u-owner' };
  const ok = jwt.sign({ id: 'u-owner', kind: 'finanzas' }, 'test-secret', { expiresIn: '1h' });
  assert.equal(hasFinanzasToken({ headers: { 'x-finanzas-token': ok } }, ses), true);
  assert.equal(hasFinanzasToken({ headers: { 'x-finanzas-token': ok } }, { id: 'otro' }), false);
  assert.equal(hasFinanzasToken({ headers: { 'x-finanzas-token': jwt.sign({ id: 'u-owner', kind: 'finanzas' }, 'test-secret', { expiresIn: -10 }) } }, ses), false);
  assert.equal(hasFinanzasToken({ headers: { 'x-finanzas-token': jwt.sign({ id: 'u-owner', kind: 'finanzas' }, 'otro-secreto') } }, ses), false);
  assert.equal(hasFinanzasToken({ headers: { 'x-finanzas-token': OWNER } }, ses), false, 'una sesión normal del ATS no vale como token de Finanzas');
  assert.equal(hasFinanzasToken({ headers: {} }, ses), false);
});

// ── api/finanzas-pin ──────────────────────────────────────────────────────
test('finanzas-pin: PIN correcto devuelve un token que sirve; incorrecto da 403 sin token', async () => {
  const mal = await pin('POST', { pin: '0000' });
  assert.equal(mal.status, 403);
  assert.equal((await mal.json()).token, undefined);
  const bien = await pin('POST', { pin: PIN_OK });
  assert.equal(bien.status, 200);
  const { token } = await bien.json();
  assert.equal(jwt.verify(token, 'test-secret').kind, 'finanzas');
});
test('finanzas-pin: solo owner (recruiter y sin sesión, no)', async () => {
  assert.equal((await pin('POST', { pin: PIN_OK }, RECRUITER)).status, 403);
  const sin = await realFetch(pinSrv.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: PIN_OK }) });
  assert.equal(sin.status, 401);
});
test('finanzas-pin: freno de intentos, el 6º seguido da 429 aunque sea el PIN correcto', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await pin('POST', { pin: '0000' })).status, 403);
  assert.equal((await pin('POST', { pin: PIN_OK })).status, 429);
});
test('finanzas-pin: el límite es por usuario: otro owner no queda bloqueado', async () => {
  for (let i = 0; i < 6; i++) await pin('POST', { pin: '0000' });
  assert.equal((await pin('POST', { pin: PIN_OK }, OWNER2)).status, 200);
});
test('finanzas-pin: un PIN correcto limpia el contador', async () => {
  for (let i = 0; i < 4; i++) await pin('POST', { pin: '0000' });
  assert.equal((await pin('POST', { pin: PIN_OK })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await pin('POST', { pin: '0000' })).status, 403);
});
test('finanzas-pin: valida el formato del PIN', async () => {
  for (const p of ['12', 'abcd', '123456789', 1234, null]) assert.equal((await pin('POST', { pin: p })).status, 400, String(p));
});
test('finanzas-pin: sin PIN configurado falla cerrado (500), no deja pasar', async () => {
  db.app_settings = [];
  assert.equal((await pin('POST', { pin: PIN_OK })).status, 500);
});
test('finanzas-pin PUT: cambia el PIN (pide el actual); el viejo deja de servir', async () => {
  const mal = await pin('PUT', { pin: '0000', nuevo: '9999' });
  assert.equal(mal.status, 403);
  const ok = await pin('PUT', { pin: PIN_OK, nuevo: '98765' });
  assert.equal(ok.status, 200);
  assert.equal((await pin('POST', { pin: PIN_OK })).status, 403);
  assert.equal((await pin('POST', { pin: '98765' })).status, 200);
  assert.ok(!JSON.stringify(db.app_settings).includes('98765'), 'el PIN nuevo se guarda hasheado');
});
test('finanzas-pin PUT: rechaza PIN nuevo inválido y no cambia nada', async () => {
  const antes = db.app_settings[0].value;
  for (const n of ['12', 'abcd', undefined]) assert.equal((await pin('PUT', { pin: PIN_OK, nuevo: n })).status, 400, String(n));
  assert.equal(db.app_settings[0].value, antes);
});

// ── owner-data: exigencia del token ───────────────────────────────────────
test('owner-data: sin token de Finanzas, las tablas de plata dan 403 con code finanzas_pin', async () => {
  const r = await data('table=billing&select=*');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'finanzas_pin');
  for (const t of ['facturas', 'embedded_nomina', 'embedded_nomina_personas', 'finanzas_log']) {
    db[t] = db[t] || [];
    assert.equal((await data(`table=${t}&select=*`)).status, 403, t);
  }
});
test('owner-data: con el token de Finanzas lee billing', async () => {
  const r = await data('table=billing&select=*', { fin: await tokenFinanzas() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 2);
});
test('owner-data: el token de otro owner no sirve', async () => {
  const r = await data('table=billing&select=*', { fin: await tokenFinanzas(OWNER2) });
  assert.equal(r.status, 403);
});
test('owner-data: billing POST (alta de hire) sigue abierta para recruiter sin token', async () => {
  const r = await data('table=billing', { method: 'POST', token: RECRUITER, body: [{ client_name: 'C', estado: 'por_facturar' }] });
  assert.equal(r.status, 200);
});
test('owner-data: un recruiter no puede LEER billing aunque mande un token de owner', async () => {
  const fin = await tokenFinanzas();
  assert.equal((await data('table=billing&select=*', { token: RECRUITER, fin })).status, 403);
});
test('owner-data: las tablas que no son de plata no piden el token (users, clientes)', async () => {
  db.users = [{ id: 'x', email: 'a', password: 'h' }];
  assert.equal((await data('table=users&select=*')).status, 200);
});

// ── owner-data: registro de cambios ───────────────────────────────────────
test('registro: pasar facturado → cobrado deja quién, qué fila, antes y después', async () => {
  const fin = await tokenFinanzas();
  const r = await data('table=billing&id=eq.b1', { method: 'PATCH', body: { estado: 'cobrado' }, fin });
  assert.equal(r.status, 200);
  assert.equal(db.finanzas_log.length, 1);
  const l = db.finanzas_log[0];
  assert.equal(l.user_name, 'josie@hwgtalent.com');
  assert.equal(l.tabla, 'billing'); assert.equal(l.row_id, 'b1'); assert.equal(l.accion, 'estado');
  assert.deepEqual(l.antes, { estado: 'facturado' });
  assert.deepEqual(l.despues, { estado: 'cobrado' });
});
test('registro: un PATCH que no cambia nada no ensucia el log', async () => {
  const fin = await tokenFinanzas();
  await data('table=billing&id=eq.b1', { method: 'PATCH', body: { estado: 'facturado' }, fin });
  assert.equal(db.finanzas_log.length, 0);
});
test('registro: un PATCH sobre varias filas deja una entrada por fila', async () => {
  const fin = await tokenFinanzas();
  await data('table=billing&recruiter_pagado=eq.false', { method: 'PATCH', body: { recruiter_pagado: true }, fin });
  assert.equal(db.finanzas_log.length, 2);
});
test('registro: borrar guarda la fila completa y se registra ANTES de borrar', async () => {
  const fin = await tokenFinanzas();
  const r = await data('table=billing&id=eq.b2', { method: 'DELETE', fin });
  assert.equal(r.status, 200);
  assert.equal(db.billing.length, 1);
  const l = db.finanzas_log[0];
  assert.equal(l.accion, 'borrar'); assert.equal(l.antes.client_name, 'B'); assert.equal(l.despues, null);
});
test('registro: si el log falla, NO se borra (nunca plata sin rastro)', async () => {
  const fin = await tokenFinanzas();
  failLog = true;
  const r = await data('table=billing&id=eq.b2', { method: 'DELETE', fin });
  assert.equal(r.status, 500);
  assert.equal(db.billing.length, 2, 'la fila sigue ahí');
});
test('registro: crear un hire queda registrado con quién lo creó', async () => {
  await data('table=billing', { method: 'POST', token: RECRUITER, body: [{ client_name: 'C', estado: 'por_facturar' }] });
  assert.equal(db.finanzas_log.length, 1);
  assert.equal(db.finanzas_log[0].accion, 'crear');
  assert.equal(db.finanzas_log[0].user_name, 'rec@hwgtalent.com');
});
test('registro: finanzas_log es de solo lectura por la API (no se puede falsificar ni borrar)', async () => {
  const fin = await tokenFinanzas();
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    const r = await data('table=finanzas_log&id=eq.1', { method: m, body: m === 'DELETE' ? undefined : [{ x: 1 }], fin });
    assert.equal(r.status, 405, m);
  }
});
test('registro: se puede leer con el token de Finanzas', async () => {
  const fin = await tokenFinanzas();
  await data('table=billing&id=eq.b1', { method: 'PATCH', body: { estado: 'cobrado' }, fin });
  const r = await data('table=finanzas_log&select=*&row_id=eq.b1', { fin });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 1);
});

// ── CORS: el navegador solo manda X-Finanzas-Token si el servidor lo permite ──
test('owner-data: el preflight CORS permite la cabecera X-Finanzas-Token (sin esto el navegador no la manda y Finanzas queda bloqueado)', async () => {
  const r = await realFetch(`${dataSrv.url}/?table=billing`, { method: 'OPTIONS' });
  const permitidas = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
  assert.ok(permitidas.includes('x-finanzas-token'), permitidas);
  assert.ok(permitidas.includes('authorization'));
});
