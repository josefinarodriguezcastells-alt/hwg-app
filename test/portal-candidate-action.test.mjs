// Control de acceso de api/portal-candidate-action.js — el más importante
// de los endpoints de escritura del portal (rechaza un candidato real o
// pide agendar, y manda un mail), foco de la auditoría de los 20
// endpoints: portal_token solo no probaba que quien llama pasó la pantalla
// de PIN. Supabase y Resend están mockeados en memoria (con los mismos
// filtros PostgREST que usa el handler); nunca se toca la base ni sale un
// mail de verdad.
//
// Correr con: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.RESEND_API_KEY = 're-fake';
process.env.SESSION_SECRET = 'test-secret';

const CLIENTS = [
  { id: 'c1', name: 'Acme & Co', portal_token: 'PORTAL_OK', portal_pin: '1234', portal_active: true },
  { id: 'c2', name: 'Inactivo', portal_token: 'PORTAL_INACTIVO', portal_pin: '1234', portal_active: false },
  { id: 'c3', name: 'Otro cliente', portal_token: 'PORTAL_OTRO', portal_pin: '5678', portal_active: true },
];
const POSITIONS = { p1: { id: 'p1', role: 'Data Engineer', client_id: 'c1' }, p3: { id: 'p3', role: 'Otro puesto', client_id: 'c3' } };
const CANDIDATES = { k1: { id: 'k1', name: 'Cande Real' } };
const RECRUITERS = [{ id: 'u1', email: 'rec@hwgtalent.com' }];
const POSITION_RECRUITERS = [{ position_id: 'p1', recruiter_id: 'u1' }];

let applications, statusHistory, notes, mails, bearer;
beforeEach(() => {
  applications = [{ id: 'a1111111-1111-4111-8111-111111111111', status: 'submitted', candidate_id: 'k1', position_id: 'p1' }];
  statusHistory = [];
  notes = [];
  mails = [];
  bearer = (role) => ({ authorization: 'Bearer ' + jwt.sign({ id: 1, email: 'a@b.c', role }, 'test-secret') });
});

const q = (url, key) => new URL(url).searchParams.get(key);
const eq = (url, key) => (q(url, key) || '').replace(/^eq\./, '');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://api.resend.com')) {
    mails.push(JSON.parse(opts.body));
    return json({ id: 'mail-fake' });
  }
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const table = new URL(url).pathname.split('/').pop();

  if (table === 'clients') {
    const tok = eq(url, 'portal_token');
    const pin = q(url, 'portal_pin');
    let rows = CLIENTS.filter(c => c.portal_token === tok);
    if (pin) rows = rows.filter(c => 'eq.' + c.portal_pin === pin);
    rows = rows.filter(c => q(url, 'portal_active') !== 'eq.true' || c.portal_active);
    return json(rows.map(({ id, name }) => ({ id, name })));
  }
  if (table === 'applications') {
    if (opts.method === 'PATCH') {
      const id = eq(url, 'id');
      const statusFilter = q(url, 'status');
      const idx = applications.findIndex(a => a.id === id && (!statusFilter || 'eq.' + a.status === statusFilter));
      if (idx === -1) return json([]);
      applications[idx] = { ...applications[idx], ...JSON.parse(opts.body) };
      return json([applications[idx]]);
    }
    const id = eq(url, 'id');
    const app = applications.find(a => a.id === id);
    if (!app) return json([]);
    return json([{ ...app, positions: POSITIONS[app.position_id] }]);
  }
  if (table === 'candidates') {
    const id = eq(url, 'id');
    return json(CANDIDATES[id] ? [CANDIDATES[id]] : []);
  }
  if (table === 'status_history') {
    statusHistory.push(...JSON.parse(opts.body));
    return json([], 201);
  }
  if (table === 'client_portal_notes') {
    notes.push(...JSON.parse(opts.body));
    return json([], 201);
  }
  if (table === 'position_recruiters') {
    const posId = eq(url, 'position_id');
    return json(POSITION_RECRUITERS.filter(r => r.position_id === posId));
  }
  if (table === 'users') {
    const ids = (q(url, 'id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(RECRUITERS.filter(u => ids.includes(u.id)));
  }
  throw new Error('tabla no mockeada: ' + table);
};

const handler = require('../api/portal-candidate-action.js');
async function call(body, headers = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method: 'POST', headers, body }, res);
  return out;
}
const req = (extra) => ({ portal_token: 'PORTAL_OK', portal_pin: '1234', application_id: 'a1111111-1111-4111-8111-111111111111', action: 'reject', text: 'no cumple', ...extra });

test('preflight', async () => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, end() { return this; } };
  await handler({ method: 'OPTIONS' }, res);
  assert.equal(out.status, 200);
});

// ── Acceso: el foco de este archivo ────────────────────────────────────────

// Paso 1/3 (Greptile en #25): con required:false (api/_portal.js), sin PIN
// ni sesión todavía funciona con el token solo — igual que antes de este
// PR — mientras el ATS que manda el PIN (hwg_ats#64) termina de
// deployarse, para no dejar sin poder rechazar/agendar a los clientes en
// el medio. El paso 3 (aparte) pasa a required:true y este caso vuelve a
// dar 401.
test('sin PIN ni sesión: todavía funciona con el token solo (paso 1/3 — required:false)', async () => {
  const r = await call(req({ portal_pin: undefined }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(applications[0].status, 'rechazado');
});

test('sin portal_token → 400 (esto sí se exige siempre, con o sin PIN)', async () => {
  const r = await call(req({ portal_token: undefined, portal_pin: undefined }));
  assert.equal(r.status, 400);
  assert.equal(applications[0].status, 'submitted');
  assert.equal(mails.length, 0);
});

test('PIN incorrecto → 403, no toca applications', async () => {
  const r = await call(req({ portal_pin: '0000' }));
  assert.equal(r.status, 403);
  assert.equal(applications[0].status, 'submitted');
});

test('portal inactivo (con su PIN correcto) → 403', async () => {
  const r = await call(req({ portal_token: 'PORTAL_INACTIVO' }));
  assert.equal(r.status, 403);
});

test('PIN correcto pero de OTRO cliente → 403 (el PIN es por cliente, no genérico)', async () => {
  const r = await call(req({ portal_pin: '5678' }));
  assert.equal(r.status, 403);
});

test('sesión del owner sin PIN también sirve', async () => {
  const r = await call(req({ portal_pin: undefined }), bearer('owner'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('sesión de recruiter (no owner) no alcanza para el bypass del portal', async () => {
  const r = await call(req({ portal_pin: undefined }), bearer('recruiter'));
  assert.equal(r.status, 403);
});

test('application_id de una posición de OTRO cliente (con el PIN correcto de PORTAL_OK) → 403', async () => {
  applications.push({ id: 'a3333333-3333-4333-8333-333333333333', status: 'submitted', candidate_id: 'k1', position_id: 'p3' });
  const r = await call(req({ application_id: 'a3333333-3333-4333-8333-333333333333' }));
  assert.equal(r.status, 403);
});

// ── Camino feliz — prueba que el cambio de resolvePortalClient a
// resolvePortalWriter no rompió el resto del handler ────────────────────

test('reject con PIN correcto: cambia el estado, guarda el motivo y manda el mail al recruiter', async () => {
  const r = await call(req());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(applications[0].status, 'rechazado');
  assert.equal(applications[0].rejection_quien, 'cliente');
  assert.equal(applications[0].rejection_motivo, 'no cumple');
  assert.equal(statusHistory.length, 1);
  assert.equal(notes.length, 1);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['rec@hwgtalent.com']);
  assert.equal(mails[0].cc, 'josie@hwgtalent.com');
});

test('schedule con sesión de owner: cambia el estado y no exige texto salvo que esté vacío', async () => {
  const r = await call(req({ portal_pin: undefined, action: 'schedule', text: 'lunes 10am' }), bearer('owner'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(applications[0].status, 'entrevista_cliente_fit');
});

test('estado que ya no admite la acción (ej. "offer") → 409, sin tocar nada', async () => {
  applications[0].status = 'offer';
  const r = await call(req());
  assert.equal(r.status, 409);
  assert.equal(applications[0].status, 'offer');
});
