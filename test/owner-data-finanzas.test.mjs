// api/owner-data.js — reglas de Finanzas: el autor de cada cambio sale de la
// SESIÓN, las facturas no se crean ni se pisan por acá (solo las funciones de
// facturación), y factura_items / finanzas_auditoria son de solo lectura.
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

const OWNER = '11111111-1111-4111-8111-111111111111';
const RECRUITER = '99999999-9999-4999-8999-999999999999';

let calls, sinColumna;
beforeEach(() => { calls = []; sinColumna = false; });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  calls.push({ url, method: opts.method || 'GET', body });
  // Simula la base ANTES de la migración: updated_by no existe.
  const trae = (b) => Array.isArray(b) ? b.some(r => 'updated_by' in r) : b && 'updated_by' in b;
  if (sinColumna && trae(body)) {
    return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'updated_by' column of 'billing' in the schema cache" }), { status: 400 });
  }
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

test('billing PATCH: updated_by sale de la sesión aunque el cliente mande otro', async () => {
  const r = await call('PATCH', { table: 'billing', id: 'eq.1' }, { notas: 'ok', updated_by: 'falso' });
  assert.equal(r.status, 200);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.body.updated_by, OWNER);
  assert.equal(patch.body.notas, 'ok');
  assert.ok(patch.body.updated_at);
});

test('billing POST de un recruiter (cierre de contratación): queda él como autor', async () => {
  const r = await call('POST', { table: 'billing' }, { candidate_name: 'Ana', client_name: 'X', estado: 'por_facturar' }, { role: 'recruiter', id: RECRUITER });
  assert.equal(r.status, 200);
  assert.equal(calls[0].body.updated_by, RECRUITER);
});

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

test('facturas PATCH: el link y la nota siguen editables, con autor', async () => {
  const r = await call('PATCH', { table: 'facturas', id: 'eq.1' }, { link: 'https://x', nota: 'n' });
  assert.equal(r.status, 200);
  assert.equal(calls[0].body.updated_by, OWNER);
});

test('DELETE de billing/facturas: antes deja al usuario como autor para la auditoría', async () => {
  for (const table of ['billing', 'facturas']) {
    calls = [];
    const r = await call('DELETE', { table, id: 'eq.1' });
    assert.equal(r.status, 200);
    assert.deepEqual(calls.map(c => c.method), ['PATCH', 'DELETE'], table);
    assert.equal(calls[0].body.updated_by, OWNER);
  }
});

test('factura_items y finanzas_auditoria: solo lectura, solo owner', async () => {
  for (const table of ['factura_items', 'finanzas_auditoria']) {
    assert.equal((await call('GET', { table })).status, 200, table);
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await call(m, { table, id: 'eq.1' }, { a: 1 })).status, 405, table + ' ' + m);
    }
    assert.equal((await call('GET', { table }, undefined, { role: 'recruiter', id: RECRUITER })).status, 403, table);
  }
});

test('las otras tablas no reciben updated_by (no existe esa columna)', async () => {
  await call('PATCH', { table: 'embedded_nomina_personas', id: 'eq.1' }, { activo: false });
  assert.equal('updated_by' in calls[0].body, false);
});

test('ANTES de correr la migración (sin columna updated_by) las escrituras de billing siguen andando', async () => {
  sinColumna = true;
  const r = await call('POST', { table: 'billing' }, { candidate_name: 'Ana', estado: 'por_facturar' }, { role: 'recruiter', id: RECRUITER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls.length, 2, 'primero con sello, después reintenta sin sello');
  assert.equal('updated_by' in calls[1].body, false);
  assert.equal(calls[1].body.candidate_name, 'Ana');
  calls = [];
  const p = await call('PATCH', { table: 'billing', id: 'eq.1' }, { notas: 'x' });
  assert.equal(p.status, 200);
  assert.equal('updated_by' in calls[1].body, false);
});

test('un error real de billing (no de la columna) NO se reintenta ni se esconde', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: '23514', message: 'viola el check de estado' }), { status: 400 });
  const r = await call('PATCH', { table: 'billing', id: 'eq.1' }, { estado: 'cualquiera' });
  assert.equal(r.status, 400);
  assert.match(JSON.stringify(r.body), /check de estado/);
});
