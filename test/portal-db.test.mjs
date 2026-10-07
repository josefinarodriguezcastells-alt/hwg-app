// api/portal-db.js + api/_portal-policy.js: el proxy del portal de clientes.
// Supabase mockeado: se registran los pedidos que saldrían hacia la base y se
// verifica el ALCANCE que fuerza el servidor (el cliente de la sesión, columnas
// permitidas según portal_permissions, escrituras acotadas). Casos de ataque:
// otro cliente, columnas internas, relaciones, filtros-oráculo, escrituras.
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
const { signPortal, verifyPortal } = require('../api/_auth.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SES_A = signPortal(A), SES_B = signPortal(B);
const OWNER = jwt.sign({ id: 'u1', email: 'o@x', role: 'owner' }, 'test-secret');

let llamadas, perms, activo, posiciones, apps, equipo;
beforeEach(() => {
  llamadas = []; perms = { cv: true, email: false, phone: false, linkedin: false }; activo = true;
  posiciones = { [A]: ['p1', 'p2'], [B]: ['p9'] };
  equipo = { p1: ['r1'], p2: ['r1', 'r2'], p9: ['r9'] };
  apps = [{ id: 'a1', position_id: 'p1', candidate_id: 'k1' }, { id: 'a2', position_id: 'p2', candidate_id: 'k2' }, { id: 'a9', position_id: 'p9', candidate_id: 'k9' }];
});
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  if (!url.startsWith('https://fake.supabase.co/rest/v1/')) throw new Error('fetch no mockeado: ' + url);
  const u = new URL(url); const tabla = u.pathname.replace('/rest/v1/', ''); const sp = u.searchParams;
  llamadas.push({ url, tabla, sp, method: (opts.method || 'GET').toUpperCase(), body: opts.body });
  const val = (k) => (sp.get(k) || '').replace(/^(eq|in)\./, '').replace(/[()]/g, '');
  if (tabla === 'clients' && sp.get('select') === 'id,portal_permissions') return json(activo && val('id') ? [{ id: val('id'), portal_permissions: perms }] : []);
  if (tabla === 'positions' && sp.get('select') === 'id') return json((posiciones[val('client_id')] || []).map((id) => ({ id })));
  if (tabla === 'position_recruiters' && sp.get('select') === 'recruiter_id') { const ps = val('position_id').split(','); return json(ps.flatMap((p) => (equipo[p] || []).map((r) => ({ recruiter_id: r })))); }
  if (tabla === 'applications' && sp.get('select') === 'candidate_id') { const ps = val('position_id').split(','); return json(apps.filter((a) => ps.includes(a.position_id)).map((a) => ({ candidate_id: a.candidate_id }))); }
  if (tabla === 'applications' && sp.get('select') === 'id' && sp.get('id')) { const ids = val('id').split(','), ps = val('position_id').split(','); return json(apps.filter((a) => ids.includes(a.id) && ps.includes(a.position_id)).map((a) => ({ id: a.id }))); }
  if (tabla === 'applications' && sp.get('select') === 'candidate_id' ) return json([]);
  return json([{ id: 'x' }]); // la consulta "final"
};
// la consulta de candidatos de una nota: applications?candidate_id=in.(..)&position_id=in.(..)&select=candidate_id
const _f = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url).startsWith('http') ? String(url) : 'http://x');
  if (u.hostname === 'fake.supabase.co' && u.pathname.endsWith('/applications') && u.searchParams.get('select') === 'candidate_id' && u.searchParams.get('candidate_id')) {
    llamadas.push({ url: String(url), tabla: 'applications', sp: u.searchParams, method: 'GET' });
    const cs = u.searchParams.get('candidate_id').replace(/^in\./, '').replace(/[()]/g, '').split(','), ps = u.searchParams.get('position_id').replace(/^in\./, '').replace(/[()]/g, '').split(',');
    return json(apps.filter((a) => cs.includes(a.candidate_id) && ps.includes(a.position_id)).map((a) => ({ candidate_id: a.candidate_id })));
  }
  return _f(url, opts);
};

let srv;
before(async () => {
  const handler = require('../api/portal-db.js');
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
const call = (qs, { method = 'GET', ses = SES_A, body, headers = {} } = {}) => realFetch(`${srv.url}/?${qs}`, {
  method, body: body !== undefined ? JSON.stringify(body) : undefined,
  headers: { 'Content-Type': 'application/json', ...(ses ? { Authorization: 'Bearer ' + ses } : {}), ...headers },
});
const finales = () => llamadas.filter((l) => !((l.tabla === 'position_recruiters' && l.sp.get('select') === 'recruiter_id') || l.sp.get('select') === 'id,portal_permissions' || (l.tabla === 'positions' && l.sp.get('select') === 'id') || (l.tabla === 'applications' && (l.sp.get('select') === 'candidate_id' || (l.sp.get('select') === 'id' && l.sp.has('id') && l.sp.has('position_id') && !l.body && l.sp.get('id').startsWith('in.'))))));
const ultima = () => finales().pop();

// ── sesión ────────────────────────────────────────────────────────────────
test('verifyPortal: solo una sesión de portal válida; ni la del ATS, ni vencida, ni de otra clave', () => {
  const req = (t) => ({ headers: { authorization: 'Bearer ' + t } });
  assert.deepEqual(verifyPortal(req(SES_A)), { cid: A });
  assert.equal(verifyPortal(req(OWNER)), null, 'la sesión del ATS no vale como sesión de portal');
  assert.equal(verifyPortal(req(jwt.sign({ kind: 'portal', cid: A }, 'otra-clave'))), null);
  assert.equal(verifyPortal(req(jwt.sign({ kind: 'portal', cid: A }, 'test-secret', { expiresIn: -5 }))), null);
  assert.equal(verifyPortal(req(jwt.sign({ kind: 'portal' }, 'test-secret'))), null, 'sin cid');
  assert.equal(verifyPortal({ headers: {} }), null);
});
test('sin sesión de portal → 401 sin tocar la base; la sesión del ATS tampoco sirve acá', async () => {
  assert.equal((await call('__t=positions&select=*', { ses: null })).status, 401);
  assert.equal((await call('__t=positions&select=*', { ses: OWNER })).status, 401);
  assert.equal((await call('__t=positions&select=*', { ses: jwt.sign({ kind: 'portal', cid: A }, 'otra') })).status, 401);
  assert.equal(llamadas.length, 0);
});

// ── pantalla del PIN (sin sesión) ─────────────────────────────────────────
test('sin sesión, solo se puede preguntar por la empresa de un link: id, nombre y si está activa', async () => {
  const r = await call('__t=clients&select=id,name,portal_active&portal_token=eq.TOK123', { ses: null, headers: { 'X-Portal-Token': 'TOK123' } });
  assert.equal(r.status, 200);
  const l = ultima();
  assert.equal(l.sp.get('select'), 'id,name,portal_active');
  assert.equal(l.sp.get('portal_token'), 'eq.TOK123');
  assert.equal(l.sp.get('portal_active'), 'eq.true');
});
test('pantalla del PIN: no se puede pedir otra columna, otra tabla, ni escribir', async () => {
  const h = { 'X-Portal-Token': 'TOK123' };
  assert.equal((await call('__t=clients&select=portal_token&portal_token=eq.TOK123', { ses: null, headers: h })).status, 400);
  assert.equal((await call('__t=clients&select=name&portal_pin=eq.1234', { ses: null, headers: h })).status, 400, 'ni filtrar por el PIN');
  assert.equal((await call('__t=positions&select=*', { ses: null, headers: h })).status, 401);
  assert.equal((await call('__t=clients', { ses: null, headers: h, method: 'PATCH', body: { name: 'x' } })).status, 401);
  // el token del header manda: no se puede pedir el de otro con un filtro propio
  await call('__t=clients&select=name&portal_token=eq.OTRO', { ses: null, headers: h });
  assert.equal(ultima().sp.get('portal_token'), 'eq.TOK123');
});

// ── lecturas con sesión: alcance forzado ──────────────────────────────────
test('positions: se fuerza client_id=eq.<cliente de la sesión> y las columnas permitidas', async () => {
  await call('__t=positions&select=*&client_id=eq.' + B);
  const l = ultima();
  assert.deepEqual(l.sp.getAll('client_id'), ['eq.' + B, 'eq.' + A], 'el filtro propio se combina con AND; el del servidor siempre está');
  assert.ok(!l.sp.get('select').includes('jd,') && !l.sp.get('select').split(',').includes('notes'));
  assert.ok(l.sp.get('select').split(',').includes('salary_band'));
});
test('applications: solo postulaciones de las posiciones de ESTE cliente; sin notas internas', async () => {
  await call('__t=applications&select=*&position_id=in.(p9)');
  const l = ultima();
  assert.deepEqual(l.sp.getAll('position_id'), ['in.(p9)', 'in.(p1,p2)']);
  assert.ok(!l.sp.get('select').split(',').includes('notes'), 'notes es interno del recruiter');
  // pedir una columna prohibida junto con otras: se descarta (nunca sale); pedirla sola: 400
  await call('__t=applications&select=id,notes');
  assert.equal(ultima().sp.get('select'), 'id');
  assert.equal((await call('__t=applications&select=notes')).status, 400);
});
test('un cliente sin posiciones no ve postulaciones de nadie', async () => {
  posiciones[A] = [];
  await call('__t=applications&select=*');
  assert.equal(ultima().sp.get('position_id'), 'in.(00000000-0000-0000-0000-000000000000)');
});
test('filtros-oráculo: no se puede filtrar ni ordenar por columnas que no se devuelven', async () => {
  assert.equal((await call('__t=applications&select=id&notes=ilike.*salario*')).status, 400);
  assert.equal((await call('__t=applications&select=id&order=notes.asc')).status, 400);
  assert.equal((await call('__t=applications&select=id&or=(status.eq.offer,notes.ilike.*x*)')).status, 400);
  assert.equal((await call('__t=applications&select=id&status=eq.offer&order=last_updated.desc')).status, 200);
  assert.equal((await call('__t=candidates&select=id&email=eq.a@b.c')).status, 400, 'sin permiso de email no se puede buscar por email');
});
test('candidates: solo los de las postulaciones de este cliente, y los contactos según portal_permissions', async () => {
  await call('__t=candidates&select=id,name,cv_url,linkedin_url,email,phone,location&id=in.(k9)');
  let l = ultima();
  assert.deepEqual(l.sp.getAll('id'), ['in.(k9)', 'in.(k1,k2)'], 'k9 es de otro cliente: el alcance del servidor lo deja afuera');
  assert.equal(l.sp.get('select'), 'id,name,cv_url,location', 'solo cv habilitado; location se ve salvo que sea false');
  perms = { cv: true, linkedin: true, email: true, phone: true, location: false };
  await call('__t=candidates&select=id,name,cv_url,linkedin_url,email,phone,location');
  assert.equal(ultima().sp.get('select'), 'id,name,cv_url,linkedin_url,email,phone');
  perms = {};
  await call('__t=candidates&select=*');
  assert.equal(ultima().sp.get('select'), 'id,name,location', 'sin permisos no salen CV, LinkedIn, mail ni teléfono');
});
test('otras tablas del ATS, relaciones incrustadas y la lista de tablas cerrada', async () => {
  for (const t of ['billing', 'users', 'client_secrets', 'candidate_documents', 'scorecards', 'status_history', 'scorecard_templates', 'lead_contacts', 'finanzas_log']) {
    assert.equal((await call(`__t=${t}&select=*`)).status, 400, t);
  }
  assert.equal((await call('__t=positions&select=*,billing(*)')).status, 400);
  assert.equal((await call('__t=applications&select=id,candidates(email)')).status, 400);
  assert.equal(llamadas.filter((l) => l.tabla === 'billing').length, 0);
});
test('tablas propias (visibilidad, notas, actividad, pedidos): filtradas por client_id', async () => {
  for (const t of ['client_portal_visibility', 'client_portal_notes', 'client_portal_activity', 'client_position_requests']) {
    await call(`__t=${t}&select=*&order=created_at.desc`);
    assert.ok(ultima().sp.getAll('client_id').includes('eq.' + A), t);
  }
});
test('clients: solo la fila propia y sin PIN ni token', async () => {
  await call('__t=clients&select=*');
  const l = ultima();
  assert.equal(l.sp.get('id'), 'eq.' + A);
  assert.ok(!l.sp.get('select').includes('portal_pin') && !l.sp.get('select').includes('portal_token') && !l.sp.get('select').includes('notes'));
  assert.equal((await call('__t=clients&select=portal_token')).status, 400);
});
test('portal desactivado: aunque la sesión sea válida, 403', async () => {
  activo = false;
  assert.equal((await call('__t=positions&select=*')).status, 403);
});

// ── escrituras ────────────────────────────────────────────────────────────
test('el portal no puede borrar nada', async () => {
  assert.equal((await call('__t=client_portal_notes&id=eq.1', { method: 'DELETE' })).status, 405);
});
test('actividad: client_id sale de la sesión (no del cuerpo); acción y candidato acotados', async () => {
  const r = await call('__t=client_portal_activity', { method: 'POST', body: [{ client_id: B, candidate_id: 'k1', action: 'view', visitor_email: 'v@c.com' }] });
  assert.equal(r.status, 200);
  const b = JSON.parse(ultima().body);
  assert.equal(b[0].client_id, A);
  assert.equal((await call('__t=client_portal_activity', { method: 'POST', body: [{ action: 'borrar_todo' }] })).status, 403);
  assert.equal((await call('__t=client_portal_activity', { method: 'POST', body: [{ candidate_id: 'k9', action: 'view' }] })).status, 403, 'candidato de otro cliente');
  assert.equal((await call('__t=client_portal_activity', { method: 'POST', body: [{ action: 'login', visitor_email: 'v@c.com' }] })).status, 200, 'el login no lleva candidato');
});
test('notas: solo sobre candidatos/postulaciones propias, con límite de largo, y sin colar columnas', async () => {
  const ok = await call('__t=client_portal_notes', { method: 'POST', body: [{ client_id: B, candidate_id: 'k1', application_id: 'a1', note: 'buen perfil', seen: true, id: 'forzado' }] });
  assert.equal(ok.status, 200);
  const b = JSON.parse(ultima().body)[0];
  assert.deepEqual(Object.keys(b).sort(), ['application_id', 'candidate_id', 'client_id', 'note']);
  assert.equal(b.client_id, A);
  assert.equal((await call('__t=client_portal_notes', { method: 'POST', body: [{ candidate_id: 'k1', application_id: 'a9', note: 'x' }] })).status, 403, 'postulación ajena');
  assert.equal((await call('__t=client_portal_notes', { method: 'POST', body: [{ candidate_id: 'k9', note: 'x' }] })).status, 403, 'candidato ajeno');
  assert.equal((await call('__t=client_portal_notes', { method: 'POST', body: [{ candidate_id: 'k1', note: 'x'.repeat(5001) }] })).status, 403);
  assert.equal((await call('__t=client_portal_notes', { method: 'POST', body: [{ candidate_id: 'k1', note: '   ' }] })).status, 403);
});
test('pedido de posición: se fuerza el cliente y el estado "pending"; no se puede crear ya aprobado', async () => {
  await call('__t=client_position_requests', { method: 'POST', body: { title: 'Dev', client_id: B, status: 'approved', seen_by_admin: true } });
  const b = JSON.parse(ultima().body);
  const f = Array.isArray(b) ? b[0] : b;
  assert.equal(f.client_id, A); assert.equal(f.status, 'pending'); assert.equal(f.seen_by_admin, false);
});
test('calificar: solo client_rating (1-5 o null) y last_updated, sobre postulaciones propias', async () => {
  const r = await call('__t=applications&id=eq.a1', { method: 'PATCH', body: { client_rating: 4, last_updated: '2026-10-06T00:00:00Z' } });
  assert.equal(r.status, 200);
  assert.ok(ultima().sp.getAll('position_id').includes('in.(p1,p2)'), 'el alcance de posiciones propias se agrega también al PATCH');
  assert.equal((await call('__t=applications&id=eq.a1', { method: 'PATCH', body: { client_rating: null } })).status, 200);
  for (const mal of [{ status: 'hired' }, { client_rating: 9 }, { client_rating: 'cinco' }, { notes: 'x' }, { client_rating: 3, status: 'hired' }, {}]) {
    assert.equal((await call('__t=applications&id=eq.a1', { method: 'PATCH', body: mal })).status, 403, JSON.stringify(mal));
  }
});
test('cultura: solo tags y comentario de la fila propia; nada de PIN, token ni estado del portal', async () => {
  assert.equal((await call('__t=clients', { method: 'PATCH', body: { cultural_tags: ['x'], cultural_comment: 'y' } })).status, 200);
  assert.equal(ultima().sp.get('id'), 'eq.' + A);
  for (const mal of [{ portal_pin: '0000' }, { portal_active: false }, { name: 'x' }, { cultural_tags: [], portal_token: 'x' }, { portal_permissions: { cv: true } }]) {
    assert.equal((await call('__t=clients', { method: 'PATCH', body: mal })).status, 403, JSON.stringify(mal));
  }
});
test('no se puede crear ni modificar candidatos, posiciones ni postulaciones nuevas desde el portal', async () => {
  for (const t of ['candidates', 'positions', 'applications', 'position_recruiters', 'client_portal_visibility']) {
    assert.equal((await call(`__t=${t}`, { method: 'POST', body: [{ name: 'x' }] })).status, 403, 'POST ' + t);
  }
  for (const t of ['candidates', 'positions', 'client_portal_visibility', 'client_portal_notes']) {
    assert.equal((await call(`__t=${t}&id=eq.1`, { method: 'PATCH', body: { a: 1 } })).status, 403, 'PATCH ' + t);
  }
});
test('el cliente B nunca recibe el alcance de A (cada sesión fuerza el suyo)', async () => {
  await call('__t=positions&select=*', { ses: SES_B });
  assert.ok(ultima().sp.getAll('client_id').includes('eq.' + B));
  assert.ok(!ultima().sp.getAll('client_id').includes('eq.' + A));
});
test('el preflight CORS permite las cabeceras de supabase-js y X-Portal-Token', async () => {
  const r = await realFetch(`${srv.url}/?__t=positions`, { method: 'OPTIONS' });
  const ok = (r.headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const h of ['authorization', 'prefer', 'range', 'accept', 'accept-profile', 'content-profile', 'x-client-info', 'x-portal-token', 'content-type']) assert.ok(ok.includes(h), h);
});

test('users_public: el cliente solo ve a los recruiters de SUS posiciones (id, nombre, mail); el cliente B no ve los de A', async () => {
  const r = await call('__t=users_public&select=id,name,email&id=in.(r1,r2,r9,r77)');
  assert.equal(r.status, 200);
  const f = ultima();
  assert.equal(f.tabla, 'users_public');
  assert.equal(f.sp.get('select'), 'id,name,email');
  assert.deepEqual(f.sp.getAll('id'), ['in.(r1,r2,r9,r77)', 'in.(r1,r2)'], 'el filtro del navegador se combina con el alcance forzado (AND)');
  llamadas.length = 0;
  await call('__t=users_public&select=id,name,email', { ses: SES_B });
  assert.deepEqual(ultima().sp.getAll('id'), ['in.(r9)']);
});
test('users_public: sin recruiters → no ve a nadie; no se pide el rol ni se incrusta ni se escribe', async () => {
  equipo = {};
  await call('__t=users_public&select=id,name');
  assert.deepEqual(ultima().sp.getAll('id'), ['in.(00000000-0000-0000-0000-000000000000)']);
  assert.equal((await call('__t=users_public&select=id,role')).status, 200);
  assert.equal(ultima().sp.get('select'), 'id', 'la columna rol se descarta');
  assert.equal((await call('__t=users_public&select=role')).status, 400);
  assert.equal((await call('__t=users_public&select=id,name,applications(*)')).status, 400);
  assert.equal((await call('__t=users_public', { method: 'POST', body: { name: 'x' } })).status, 403);
  assert.equal((await call('__t=users_public&id=eq.r1', { method: 'PATCH', body: { name: 'x' } })).status, 403);
});
