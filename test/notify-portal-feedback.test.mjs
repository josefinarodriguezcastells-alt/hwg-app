// Control de acceso de api/notify-portal-feedback.js — auditoría de los 20
// endpoints: portal_token solo no probaba que quien llama pasó la pantalla
// de PIN. Supabase y Resend están mockeados en memoria; nunca se toca la
// base ni sale un mail de verdad.
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
  { id: 'c3', name: 'Otro cliente', portal_token: 'PORTAL_OTRO', portal_pin: '5678', portal_active: true },
];
const APP_ID = 'a1111111-1111-4111-8111-111111111111';
const applications = { [APP_ID]: { id: APP_ID, candidate_id: 'k1', client_rating: 4, position: { id: 'p1', role: 'Data Engineer', client_id: 'c1' } } };
const CANDIDATES = { k1: { id: 'k1', name: 'Cande Real' } };
const RECRUITERS = [{ id: 'u1', email: 'rec@hwgtalent.com' }];
const POSITION_RECRUITERS = [{ position_id: 'p1', recruiter_id: 'u1' }];

let notesByApp, mails, bearer;
beforeEach(() => {
  notesByApp = { [APP_ID]: [{ note: '[avanzar] muy buen candidato', created_at: '2026-09-01T00:00:00Z' }] };
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
    return json(rows.map(({ id, name }) => ({ id, name })));
  }
  if (table === 'applications') {
    const id = eq(url, 'id');
    const app = applications[id];
    return json(app ? [{ id: app.id, candidate_id: app.candidate_id, client_rating: app.client_rating, positions: app.position }] : []);
  }
  if (table === 'candidates') {
    const id = eq(url, 'id');
    return json(CANDIDATES[id] ? [CANDIDATES[id]] : []);
  }
  if (table === 'client_portal_notes') {
    const appId = eq(url, 'application_id');
    const rows = (notesByApp[appId] || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    return json(rows.slice(0, 1));
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

const handler = require('../api/notify-portal-feedback.js');
async function call(body, headers = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.body = j; return this; } };
  await handler({ method: 'POST', headers, body }, res);
  return out;
}
const req = (extra) => ({ portal_token: 'PORTAL_OK', portal_pin: '1234', application_id: APP_ID, kind: 'rating', lang: 'es', ...extra });

test('preflight', async () => {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, end() { return this; } };
  await handler({ method: 'OPTIONS' }, res);
  assert.equal(out.status, 200);
});

// ── Acceso ──────────────────────────────────────────────────────────────

test('sin PIN ni sesión → 401, no manda mail', async () => {
  const r = await call(req({ portal_pin: undefined }));
  assert.equal(r.status, 401);
  assert.equal(mails.length, 0);
});

test('PIN incorrecto → 403, no manda mail', async () => {
  const r = await call(req({ portal_pin: '0000' }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('PIN de OTRO cliente → 403', async () => {
  const r = await call(req({ portal_pin: '5678' }));
  assert.equal(r.status, 403);
});

test('sesión del owner sin PIN también sirve', async () => {
  const r = await call(req({ portal_pin: undefined }), bearer('owner'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('sesión de recruiter (no owner) no alcanza', async () => {
  const r = await call(req({ portal_pin: undefined }), bearer('recruiter'));
  assert.equal(r.status, 403);
});

// ── Camino feliz — el cambio de client resolution no rompió el resto ──────

test('rating: manda el mail con el rating YA guardado, no uno inventado en el pedido', async () => {
  const r = await call(req({ kind: 'rating' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mails.length, 1);
  assert.match(mails[0].html, /4\/5/);
  assert.deepEqual(mails[0].to, ['rec@hwgtalent.com']);
  assert.equal(mails[0].cc, 'josie@hwgtalent.com');
});

test('comment: manda el mail con la nota YA guardada, sin el prefijo [verdict]', async () => {
  const r = await call(req({ kind: 'comment' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(mails[0].html, /muy buen candidato/);
  assert.doesNotMatch(mails[0].html, /\[avanzar\]/);
});

test('application_id de otro cliente (con el PIN correcto de PORTAL_OK) → 403', async () => {
  const r = await call(req({ portal_token: 'PORTAL_OTRO', portal_pin: '5678' }));
  assert.equal(r.status, 403);
});
