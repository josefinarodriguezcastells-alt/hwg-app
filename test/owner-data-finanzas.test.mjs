// api/owner-data.js — reglas de facturas en Finanzas: no se crean ni se pisan
// por acá (solo las funciones de facturación de api/finanzas-facturas.js),
// billing no acepta cambiar factura_id a mano y factura_items es de solo lectura.
// El registro de cambios (finanzas_log) y el PIN se prueban en finanzas-pin.test.mjs.
// Supabase mockeado; nunca se toca la base.
//
// Correr con: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';
process.env.FINANZAS_PIN_ENFORCE = '0'; // el PIN se prueba aparte (finanzas-facturas-pin.test.mjs, finanzas-pin.test.mjs)

const OWNER = '11111111-1111-4111-8111-111111111111';
const RECRUITER = '99999999-9999-4999-8999-999999999999';

let calls;
beforeEach(() => { calls = []; });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  calls.push({ url, method: opts.method || 'GET', body });
  return new Response(JSON.stringify([{ id: 'x' }]), { status: 200 });
};

const handler = require('../api/owner-data.js');
const bearer = (role, id) => 'Bearer ' + jwt.sign({ id, email: 'a@b.c', role }, 'test-secret');
async function call(method, query, body, { role = 'owner', id = OWNER } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  await handler({ method, query, body, headers: { authorization: bearer(role, id) } }, res);
  return out;
}

test('un recruiter sigue sin poder leer, editar ni borrar billing', async () => {
  for (const m of ['GET', 'PATCH', 'DELETE']) {
    const r = await call(m, { table: 'billing' }, m === 'PATCH' ? { notas: 'x' } : undefined, { role: 'recruiter', id: RECRUITER });
    assert.equal(r.status, 403, m);
  }
  assert.equal(calls.length, 0);
});

test('billing: el vínculo con la factura no se toca por acá', async () => {
  const r = await call('PATCH', { table: 'billing', id: 'eq.1' }, { factura_id: null });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('facturas: no se crean por acá (numeración correlativa solo por finanzas-facturas)', async () => {
  const r = await call('POST', { table: 'facturas' }, { numero: 'EMB-2026-999', total: 1 });
  assert.equal(r.status, 405);
  assert.match(r.body.error, /finanzas-facturas/);
  assert.equal(calls.length, 0);
});

test('facturas PATCH: número, total, estado y cobro están protegidos', async () => {
  for (const campo of ['numero', 'total', 'items', 'moneda', 'client_id', 'estado', 'fecha_cobro', 'anulada_at', 'emitida_at']) {
    const r = await call('PATCH', { table: 'facturas', id: 'eq.1' }, { [campo]: 'x' });
    assert.equal(r.status, 400, campo);
    assert.match(r.body.error, new RegExp(campo));
  }
  assert.equal(calls.length, 0);
});

test('facturas PATCH: el link y la nota siguen editables', async () => {
  const r = await call('PATCH', { table: 'facturas', id: 'eq.1' }, { link: 'https://x', nota: 'n' });
  assert.equal(r.status, 200);
});

test('factura_items: solo lectura y solo owner', async () => {
  assert.equal((await call('GET', { table: 'factura_items' })).status, 200);
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    assert.equal((await call(m, { table: 'factura_items', id: 'eq.1' }, { a: 1 })).status, 405, m);
  }
  assert.equal((await call('GET', { table: 'factura_items' }, undefined, { role: 'recruiter', id: RECRUITER })).status, 403);
});

