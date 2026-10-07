// api/hire-complete.js: cada hire confirmado termina con su línea en Finanzas.
// Supabase mockeado con una base en memoria.
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
const { fechaValida } = require('../api/hire-complete.js');

const APP = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const ses = (role, id, email = role + '@x.com') => jwt.sign({ id, email, role }, 'test-secret');
const OWNER = ses('owner', 'o1'), REC = ses('recruiter', 'r1'), AJENO = ses('recruiter', 'r9'), CLIENTE = ses('client', 'c1');

let db, llamadas;
beforeEach(() => {
  llamadas = [];
  db = {
    applications: [{ id: APP, status: 'hired', recruiter_id: 'r1', position_id: 'p1', candidate_id: 'k1', start_date: null, candidates: { name: 'Ana Pérez' }, positions: { role: 'Dev', tipo: 'nueva', clients: { name: 'Acme' } }, users: { name: 'Rec Uno' } },
      { id: OTRA, status: 'offer', recruiter_id: 'r1', position_id: 'p1', candidate_id: 'k2' }],
    position_recruiters: [], status_history: [], users_public: [{ id: 'o1', name: 'Jo' }, { id: 'r1', name: 'Rec Uno' }, { id: 'r9', name: 'Otra Rec' }],
    billing: [], finanzas_log: [],
  };
});
const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const u = new URL(url); const tabla = u.pathname.replace('/rest/v1/', ''); const sp = u.searchParams; const m = (opts.method || 'GET').toUpperCase();
  llamadas.push({ tabla, m, body: opts.body ? JSON.parse(opts.body) : undefined, sp });
  const eq = (k) => (sp.get(k) || '').replace(/^eq\./, '');
  if (m === 'GET') {
    let filas = db[tabla] || [];
    for (const k of ['id', 'application_id', 'position_id', 'recruiter_id', 'changed_by', 'new_status']) if (sp.get(k)) filas = filas.filter((f) => String(f[k]) === eq(k));
    return json(filas);
  }
  if (tabla === 'billing' && m === 'POST') {
    const f = JSON.parse(opts.body)[0];
    if (f.application_id && db.billing.some((b) => b.application_id === f.application_id)) return json({ code: '23505', message: 'duplicate key value violates unique constraint "billing_application_unico"' }, 409);
    const nueva = { id: 'b' + (db.billing.length + 1), ...f }; db.billing.push(nueva); return json([nueva], 201);
  }
  if (tabla === 'billing' && m === 'PATCH') { const f = db.billing.find((b) => b.id === eq('id')); Object.assign(f, JSON.parse(opts.body)); return json([f]); }
  if (tabla === 'finanzas_log' && m === 'POST') { db.finanzas_log.push(...JSON.parse(opts.body)); return new Response(null, { status: 201 }); }
  throw new Error('no mockeado: ' + m + ' ' + tabla);
};

let srv;
before(async () => {
  const handler = require('../api/hire-complete.js');
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
const call = (body, token = REC, method = 'POST') => realFetch(srv.url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });

test('fechaValida: solo fechas reales entre 2000 y 2100', () => {
  assert.ok(fechaValida('2026-10-12')); for (const x of ['2026-02-30', '12/10/2026', '1999-01-01', '', null, 5]) assert.ok(!fechaValida(x), String(x));
});

test('acceso: sin sesión 401, cliente 403, GET 405; postulación inválida 400, inexistente 404, que no es hired 409', async () => {
  assert.equal((await call({ application_id: APP }, null)).status, 401);
  assert.equal((await call({ application_id: APP }, CLIENTE)).status, 403);
  assert.equal((await call(undefined, REC, 'GET')).status, 405);
  assert.equal((await call({ application_id: 'x' })).status, 400);
  assert.equal((await call({ application_id: '33333333-3333-4333-8333-333333333333' })).status, 404);
  assert.equal((await call({ application_id: OTRA })).status, 409);
  assert.equal(db.billing.length, 0);
});

test('datos inválidos no pasan: start date falso, salario con formato raro', async () => {
  assert.equal((await call({ application_id: APP, start_date: '2026-02-30' })).status, 400);
  for (const s of ['USD 4000; drop', 'EUR 4000', '4000', 'USD ']) assert.equal((await call({ application_id: APP, salario_bruto: s })).status, 400, s);
  assert.equal(db.billing.length, 0);
});

test('sin línea: la crea (por_facturar) con los datos del hire y el start date/salario del cierre, y la deja en el registro', async () => {
  const r = await call({ application_id: APP, start_date: '2026-11-02', salario_bruto: 'USD 4000' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, creada: true, actualizada: false });
  assert.equal(db.billing.length, 1);
  assert.deepEqual({ ...db.billing[0], id: undefined }, { id: undefined, application_id: APP, candidate_name: 'Ana Pérez', client_name: 'Acme', position_role: 'Dev', recruiter_name: 'Rec Uno', start_date: '2026-11-02', salario_bruto: 'USD 4000', tipo_busqueda: 'nueva', estado: 'por_facturar' });
  assert.equal(db.finanzas_log.length, 1); assert.equal(db.finanzas_log[0].accion, 'crear'); assert.equal(db.finanzas_log[0].user_name, 'recruiter@x.com');
});

test('omitir el modal (sin datos): igual queda la línea, con el recruiter asignado', async () => {
  const r = await call({ application_id: APP });
  assert.equal((await r.json()).creada, true);
  assert.equal(db.billing[0].start_date, null); assert.equal(db.billing[0].salario_bruto, null); assert.equal(db.billing[0].estado, 'por_facturar');
});

test('línea ya creada por el trigger: se completa con start date, salario y quién confirmó; no se duplica', async () => {
  db.billing.push({ id: 'b1', application_id: APP, candidate_name: 'Ana Pérez', client_name: 'Acme', position_role: 'Dev', recruiter_name: 'Rec Uno', start_date: null, salario_bruto: null, estado: 'por_facturar' });
  const r = await call({ application_id: APP, start_date: '2026-11-02', salario_bruto: 'ARS 1.500.000' }, OWNER);
  assert.deepEqual(await r.json(), { ok: true, creada: false, actualizada: true });
  assert.equal(db.billing.length, 1);
  assert.deepEqual([db.billing[0].start_date, db.billing[0].salario_bruto, db.billing[0].recruiter_name], ['2026-11-02', 'ARS 1.500.000', 'Jo']);
  assert.equal(db.finanzas_log.at(-1).accion, 'editar'); assert.equal(db.finanzas_log.at(-1).despues.recruiter_name, 'Jo');
  // repetir el mismo pedido no cambia nada
  const r2 = await call({ application_id: APP, start_date: '2026-11-02', salario_bruto: 'ARS 1.500.000' }, OWNER);
  assert.deepEqual(await r2.json(), { ok: true, creada: false, actualizada: false });
});

test('lo ya facturado o cobrado no se toca', async () => {
  for (const estado of ['facturado', 'cobrado', 'cancelado']) {
    db.billing = [{ id: 'b1', application_id: APP, recruiter_name: 'X', start_date: null, salario_bruto: null, estado }];
    const r = await call({ application_id: APP, start_date: '2026-11-02' });
    assert.equal((await r.json()).actualizada, false, estado);
    assert.equal(db.billing[0].start_date, null);
  }
});

test('un recruiter ajeno al hire no puede; el asignado a la posición o quien lo confirmó sí', async () => {
  assert.equal((await call({ application_id: APP }, AJENO)).status, 403);
  assert.equal(db.billing.length, 0);
  db.position_recruiters.push({ position_id: 'p1', recruiter_id: 'r9' });
  assert.equal((await call({ application_id: APP }, AJENO)).status, 200);
  db.billing = []; db.position_recruiters = []; db.status_history.push({ application_id: APP, new_status: 'hired', changed_by: 'r9' });
  assert.equal((await call({ application_id: APP }, AJENO)).status, 200);
});

test('carrera con el trigger: si la línea aparece justo antes de crearla, se completa en vez de fallar', async () => {
  const orig = globalThis.fetch;
  let primera = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (primera && u.includes('/rest/v1/billing') && (opts.method || 'GET') === 'GET' && u.includes('application_id')) {
      primera = false;
      db.billing.push({ id: 'b9', application_id: APP, recruiter_name: 'Rec Uno', start_date: null, salario_bruto: null, estado: 'por_facturar' }); // el trigger llegó primero…
      return json([]); // …pero esta lectura todavía no lo vio
    }
    return orig(url, opts);
  };
  try {
    const r = await call({ application_id: APP, start_date: '2026-11-02' });
    assert.equal(r.status, 200);
  } finally { globalThis.fetch = orig; }
  assert.equal(db.billing.length, 1); assert.equal(db.billing[0].start_date, '2026-11-02');
});

test('error al escribir: 502 sin filtrar detalles ni la clave', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (String(url).includes('/rest/v1/billing') && opts.method === 'POST' ? json({ message: 'boom svc-fake' }, 500) : orig(url, opts));
  try {
    const r = await call({ application_id: APP }); assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(await r.json()).includes('svc-fake'));
  } finally { globalThis.fetch = orig; }
});
