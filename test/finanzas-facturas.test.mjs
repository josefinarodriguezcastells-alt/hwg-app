// api/finanzas-facturas.js — emitir / anular / cobrar facturas.
// Supabase está mockeado; nunca se toca la base. La numeración, las
// validaciones de negocio y la auditoría viven en funciones de Postgres
// (probadas aparte, con un Postgres real, en hwg_ats); acá se prueba lo que
// hace el endpoint: solo owner, forma del pedido, actor tomado de la SESIÓN,
// y traducción de errores.
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

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const BILL1 = '33333333-3333-4333-8333-333333333333';
const BILL2 = '44444444-4444-4444-8444-444444444444';
const FACT = '55555555-5555-4555-8555-555555555555';

let rpcCalls, rpcResponse;
beforeEach(() => {
  rpcCalls = [];
  rpcResponse = { status: 200, body: { id: FACT, numero: 'HWG-000001' } };
});

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const m = url.match(/^https:\/\/fake\.supabase\.co\/rest\/v1\/rpc\/(\w+)$/);
  if (!m) throw new Error('fetch no mockeado: ' + url);
  rpcCalls.push({ fn: m[1], args: JSON.parse(opts.body), headers: opts.headers });
  return new Response(JSON.stringify(rpcResponse.body), { status: rpcResponse.status });
};

const handler = require('../api/finanzas-facturas.js');
const token = (role, id = OWNER_ID) => 'Bearer ' + jwt.sign({ id, email: 'a@b.c', role }, 'test-secret');
async function call(body, { role = 'owner', auth, method = 'POST', id } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(j) { out.body = j; return this; }, end() { return this; } };
  const headers = auth === null ? {} : { authorization: auth ?? token(role, id) };
  await handler({ method, headers, body }, res);
  return out;
}

const emitir = (extra = {}) => ({
  accion: 'emitir', cliente_id: CLIENT, tipo: 'contingency', moneda: 'ARS', fecha: '2026-10-05',
  lineas: [{ billing_id: BILL1, descripcion: 'Ana', monto: 1000000, fee_recruiter_monto: 200000, fee_jose: 560000, fee_sil: 240000, tc_dia: 1400 }],
  ...extra,
});

test('preflight', async () => {
  const r = await call(null, { method: 'OPTIONS' });
  assert.equal(r.status, 200);
});

test('solo POST', async () => {
  const r = await call({}, { method: 'GET' });
  assert.equal(r.status, 405);
});

test('sin sesión → 401, con recruiter → 403: nadie que no sea owner emite facturas', async () => {
  assert.equal((await call(emitir(), { auth: null })).status, 401);
  const r = await call(emitir(), { role: 'recruiter' });
  assert.equal(r.status, 403);
  assert.equal(rpcCalls.length, 0);
});

test('emitir: el actor es el usuario de la SESIÓN, aunque el pedido mande otro', async () => {
  const r = await call(emitir({ actor: 'otro', p_actor: 'otro', emitida_por: 'otro' }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.factura.numero, 'HWG-000001');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'emitir_factura');
  assert.equal(rpcCalls[0].args.p_actor, OWNER_ID);
  assert.equal(rpcCalls[0].args.p_client_id, CLIENT);
  assert.equal(rpcCalls[0].args.p_moneda, 'ARS');
  assert.equal(rpcCalls[0].headers.Authorization, 'Bearer svc-fake');
  assert.deepEqual(Object.keys(rpcCalls[0].args.p_lineas[0]).sort(),
    ['billing_id', 'descripcion', 'fee_jose', 'fee_recruiter_monto', 'fee_sil', 'monto', 'tc_dia']);
});

test('emitir: a la función solo llegan los campos conocidos de cada línea', async () => {
  const r = await call(emitir({ lineas: [{ billing_id: BILL1, monto: 5, hack: 'x', numero: 'HWG-000999' }] }));
  assert.equal(r.status, 200);
  assert.deepEqual(rpcCalls[0].args.p_lineas[0], { billing_id: BILL1, monto: 5, descripcion: '' });
});

test('emitir: validación de la forma del pedido', async () => {
  const casos = [
    [{ cliente_id: 'no-uuid' }, /cliente/],
    [{ tipo: 'otra' }, /Tipo/],
    [{ moneda: 'EUR' }, /Moneda/],
    [{ fecha: '05/10/2026' }, /Fecha/],
    [{ fecha: '2026-13-45' }, /Fecha/],
    [{ lineas: [] }, /líneas/],
    [{ lineas: 'x' }, /líneas/],
    [{ lineas: [{ billing_id: BILL1, monto: 0 }] }, /monto/],
    [{ lineas: [{ billing_id: BILL1, monto: '1000' }] }, /monto/],
    [{ lineas: [{ billing_id: 'x', monto: 10 }] }, /billing_id/],
    [{ lineas: [{ billing_id: BILL1, monto: 10, tc_dia: -1 }] }, /tc_dia/],
    [{ entidad_id: 'x' }, /Entidad/],
  ];
  for (const [extra, re] of casos) {
    const r = await call(emitir(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.body.error, re, JSON.stringify(extra));
  }
  assert.equal(rpcCalls.length, 0, 'ningún pedido inválido llega a la base');
});

test('emitir: máximo de líneas', async () => {
  const lineas = Array.from({ length: 201 }, () => ({ monto: 1 }));
  const r = await call(emitir({ lineas }));
  assert.equal(r.status, 400);
});

test('emitir Embedded: líneas sin billing_id y con entidad y período', async () => {
  const ENT = '66666666-6666-4666-8666-666666666666';
  const r = await call(emitir({ tipo: 'embedded', moneda: 'USD', entidad_id: ENT, mes: '2026-10-01', nota: 'Octubre',
    lineas: [{ descripcion: 'Nómina Juan', monto: 3000 }, { descripcion: 'Bono', monto: 500 }] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rpcCalls[0].args.p_tipo, 'embedded');
  assert.equal(rpcCalls[0].args.p_entidad_id, ENT);
  assert.equal(rpcCalls[0].args.p_mes, '2026-10-01');
});

test('una regla de negocio de la base (P0001) vuelve como 409 con su mensaje', async () => {
  rpcResponse = { status: 400, body: { code: 'P0001', message: 'Algún hire no existe, es de otro cliente o moneda, o ya está facturado.' } };
  const r = await call(emitir());
  assert.equal(r.status, 409);
  assert.match(r.body.error, /ya está facturado/);
});

test('un error inesperado de la base no filtra detalles: 500 genérico', async () => {
  rpcResponse = { status: 500, body: { code: '42P01', message: 'relation "secreta" does not exist' } };
  const r = await call(emitir());
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /secreta/);
});

test('anular: motivo obligatorio y actor de la sesión', async () => {
  let r = await call({ accion: 'anular', factura_id: FACT, motivo: '   ' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /motivo/);
  r = await call({ accion: 'anular', factura_id: FACT, motivo: 'Error de monto' });
  assert.equal(r.status, 200);
  assert.deepEqual(rpcCalls.map(c => c.fn), ['anular_factura']);
  assert.deepEqual(rpcCalls[0].args, { p_factura_id: FACT, p_motivo: 'Error de monto', p_actor: OWNER_ID });
});

test('cobrar: fecha válida y actor de la sesión', async () => {
  let r = await call({ accion: 'cobrar', factura_id: FACT, fecha_cobro: 'ayer' });
  assert.equal(r.status, 400);
  r = await call({ accion: 'cobrar', factura_id: 'x', fecha_cobro: '2026-10-20' });
  assert.equal(r.status, 400);
  r = await call({ accion: 'cobrar', factura_id: FACT, fecha_cobro: '2026-10-20' });
  assert.equal(r.status, 200);
  assert.equal(rpcCalls[0].fn, 'registrar_cobro_factura');
  assert.equal(rpcCalls[0].args.p_actor, OWNER_ID);
});

test('acción inexistente → 400', async () => {
  const r = await call({ accion: 'borrar', factura_id: FACT });
  assert.equal(r.status, 400);
});

test('una sesión sin id de usuario válido no puede emitir (no habría actor para auditar)', async () => {
  const r = await call(emitir(), { id: 'no-es-uuid' });
  assert.equal(r.status, 401);
  assert.equal(rpcCalls.length, 0);
});
