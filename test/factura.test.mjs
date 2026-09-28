// api/factura.js: arma un HTML a partir de lo que venga en ?data= (JSON en
// base64), sin login (el link es "público" a propósito, como el de un
// informe). Por eso todo lo que viene ahí tiene que ir escapado al HTML —
// sin esto, cualquiera podía armar un link con <script> embebido y
// mandarlo con la marca de HWG. No hay red ni base de datos que mockear:
// el handler es una función pura sobre el body + query.
//
// Correr con: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/factura.js');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

const call = async (query) => {
  const res = mockRes();
  await handler({ method: 'GET', query: query || {} }, res);
  return res;
};

const dataParam = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

test('preflight', async () => {
  const res = mockRes();
  await handler({ method: 'OPTIONS', query: {} }, res);
  assert.equal(res.statusCode, 200);
});

test('sin data → 400', async () => {
  const res = await call({});
  assert.equal(res.statusCode, 400);
});

test('data que no decodifica a JSON → 400', async () => {
  const res = await call({ data: 'esto-no-es-base64-json' });
  assert.equal(res.statusCode, 400);
});

test('caso normal: texto con acentos y & se ve bien, no se rompe la página', async () => {
  const res = await call({ data: dataParam({
    numero: '0042', cliente: 'Peña & Asociados', entidad_nombre: 'HWG Talent S.A.',
    moneda: 'USD', total: 1500, items: [{ texto: 'Búsqueda Sr. Data Engineer', monto: 1500 }],
  }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(res.body, /Peña &amp; Asociados/);
  assert.match(res.body, /Búsqueda Sr\. Data Engineer/);
  assert.match(res.body, /USD 1\.500/);
});

test('cliente con <script> queda escapado, no ejecutable', async () => {
  const res = await call({ data: dataParam({
    numero: '1', cliente: '<script>alert(1)</script>', entidad_nombre: 'HWG',
    total: 100, items: [],
  }) });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('nota, entidad_nombre, entidad_direccion, entidad_cuit escapados', async () => {
  const payload = 'x"><img src=1 onerror=alert(2)>';
  const res = await call({ data: dataParam({
    numero: '1', entidad_nombre: payload, entidad_direccion: payload, entidad_cuit: payload,
    nota: payload, cliente: 'ok', total: 0, items: [],
  }) });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<img src=1 onerror=alert\(2\)>/);
});

test('datos bancarios (ARS y USD) escapados', async () => {
  const payload = '"><svg onload=alert(3)>';
  const arsRes = await call({ data: dataParam({
    numero: '1', entidad_moneda: 'ARS', banco: payload, cbu: payload, alias: payload,
    entidad_cuit: payload, total: 0, items: [],
  }) });
  assert.doesNotMatch(arsRes.body, /<svg onload=alert\(3\)>/);

  const usdRes = await call({ data: dataParam({
    numero: '1', entidad_moneda: 'USD', bank_name: payload, beneficiary: payload,
    swift: payload, aba: payload, account_number: payload, total: 0, items: [],
  }) });
  assert.doesNotMatch(usdRes.body, /<svg onload=alert\(3\)>/);
});

test('ítems: texto, detalle y moneda escapados', async () => {
  const payload = '</td><script>alert(4)</script>';
  const res = await call({ data: dataParam({
    numero: '1', total: 10,
    items: [{ texto: payload, detalle: payload, moneda: payload, monto: 10 }],
  }) });
  assert.doesNotMatch(res.body, /<script>alert\(4\)<\/script>/);
});

test('mes inválido (no es una fecha real) no inyecta HTML — se muestra escapado', async () => {
  const res = await call({ data: dataParam({
    numero: '1', mes: '<b>no-es-fecha</b>', total: 0, items: [],
  }) });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<b>no-es-fecha<\/b>/);
});

test('mes válido (YYYY-MM-01) se muestra formateado, no crudo', async () => {
  const res = await call({ data: dataParam({ numero: '1', mes: '2026-03-01', total: 0, items: [] }) });
  assert.match(res.body, /Período: marzo de 2026/);
});

test('total y monto son siempre numéricos aunque venga texto — nunca HTML crudo', async () => {
  const res = await call({ data: dataParam({
    numero: '1', total: '<script>alert(5)</script>',
    items: [{ texto: 'x', monto: '<script>alert(6)</script>' }],
  }) });
  assert.doesNotMatch(res.body, /<script>/);
});

test('tipo solo puede salir como "Embedded" o "Contingency", nunca texto libre', async () => {
  const res = await call({ data: dataParam({ numero: '1', tipo: '<script>alert(7)</script>', total: 0, items: [] }) });
  assert.doesNotMatch(res.body, /<script>alert\(7\)<\/script>/);
  assert.match(res.body, /Contingency/);
});
