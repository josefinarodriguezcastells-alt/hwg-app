// api/finanzas-facturas.js con el PIN de Finanzas exigido (FINANZAS_PIN_ENFORCE=1):
// sin el token del PIN no se emite, anula ni cobra nada, igual que en owner-data.js.
// Archivo aparte porque ENFORCE_PIN se lee una sola vez, al cargar el módulo.
//
// Correr con: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.SESSION_SECRET = 'test-secret';
process.env.FINANZAS_PIN_ENFORCE = '1';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const FACT = '55555555-5555-4555-8555-555555555555';

let rpc = 0;
globalThis.fetch = async () => { rpc++; return new Response(JSON.stringify({ id: FACT }), { status: 200 }); };

const handler = require('../api/finanzas-facturas.js');
const sesion = (id = OWNER) => jwt.sign({ id, email: 'a@b.c', role: 'owner' }, 'test-secret');
const tokenPin = (id = OWNER, kind = 'finanzas') => jwt.sign({ id, kind }, 'test-secret');
async function call(headers) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers, body: { accion: 'cobrar', factura_id: FACT, fecha_cobro: '2026-10-20' } }, res);
  return out;
}

test('sin token del PIN → 403 finanzas_pin y no toca la base', async () => {
  const r = await call({ authorization: 'Bearer ' + sesion() });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'finanzas_pin');
  assert.equal(rpc, 0);
});

test('token del PIN de OTRO usuario o de otro tipo → 403', async () => {
  assert.equal((await call({ authorization: 'Bearer ' + sesion(), 'x-finanzas-token': tokenPin(OTRO) })).status, 403);
  assert.equal((await call({ authorization: 'Bearer ' + sesion(), 'x-finanzas-token': tokenPin(OWNER, 'otra-cosa') })).status, 403);
  assert.equal(rpc, 0);
});

test('con la sesión y el token del PIN del mismo usuario → pasa', async () => {
  const r = await call({ authorization: 'Bearer ' + sesion(), 'x-finanzas-token': tokenPin() });
  assert.equal(r.status, 200);
  assert.equal(rpc, 1);
});
