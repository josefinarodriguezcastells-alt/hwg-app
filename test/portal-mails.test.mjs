// Control de acceso de los mails que manda el portal de clientes:
// api/notify.js (pedido de posición) y api/notify-message.js (mensaje al
// recruiter). Supabase y Resend están mockeados: nunca sale un mail ni se
// toca la base de verdad. El mock de Supabase aplica los filtros de la URL
// (eq., in.(), ilike.) como PostgREST, así que si un endpoint deja de
// filtrar por portal activo o por cliente, estos tests lo detectan.
//
// Correr con: npm test   (o: node --test test/)

import { test, beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'svc-fake';
process.env.RESEND_API_KEY = 're-fake';
process.env.SESSION_SECRET = 'test-secret';
const jwt = createRequire(import.meta.url)('jsonwebtoken');

const DB = {
  clients: [
    { id: 'c1', name: 'Acme & Co', portal_token: 'PORTAL_OK', portal_pin: '1234', portal_active: true },
    { id: 'c2', name: 'Inactivo', portal_token: 'PORTAL_INACTIVO', portal_pin: '1234', portal_active: false },
    { id: 'c3', name: 'Otro cliente', portal_token: 'PORTAL_OTRO', portal_pin: '5678', portal_active: true },
  ],
  positions: [{ id: 'p1', client_id: 'c1' }, { id: 'p3', client_id: 'c3' }],
  position_recruiters: [{ position_id: 'p1', recruiter_id: 'u1' }, { position_id: 'p3', recruiter_id: 'u3' }],
  users: [
    { id: 'u1', email: 'Rec.Uno@hwgtalent.com', name: 'Rec Uno' },
    { id: 'u3', email: 'rec.otro@hwgtalent.com', name: 'Rec Otro' },
  ],
};

function matches(row, key, cond) {
  const val = String(row[key]);
  if (cond.startsWith('eq.')) return val === cond.slice(3);
  if (cond.startsWith('in.(')) return cond.slice(4, -1).split(',').map(decodeURIComponent).includes(val);
  if (cond.startsWith('ilike.')) {
    const re = new RegExp('^' + cond.slice(6).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    return re.test(val);
  }
  throw new Error('filtro no soportado por el mock: ' + cond);
}

let mails = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://api.resend.com')) {
    mails.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'mail-fake' }), { status: 200 });
  }
  if (url.startsWith('https://fake.supabase.co/rest/v1/')) {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    let rows = DB[table].filter(r => [...u.searchParams].every(([k, v]) =>
      ['select', 'limit', 'order'].includes(k) || matches(r, k, v)));
    if (u.searchParams.get('limit')) rows = rows.slice(0, Number(u.searchParams.get('limit')));
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  throw new Error('fetch no mockeado: ' + url);
};

const notify = (await import(new URL('../api/notify.js', import.meta.url))).default;
const notifyMessage = (await import(new URL('../api/notify-message.js', import.meta.url))).default;

async function call(handler, body, { method = 'POST', headers = {} } = {}) {
  const out = {};
  const res = {
    setHeader() {},
    status(c) { out.status = c; return this; },
    json(j) { out.body = j; return this; },
    end() { return this; },
  };
  await handler({ method, headers, body }, res);
  return out;
}

const EVIL = '<a href="https://evil.example">clic</a>';

beforeEach(() => { mails = []; });

// ── notify (pedido de posición) ───────────────────────────────────────────
//
// Auditoría de los 20 endpoints: portal_token solo (viaja en la URL del
// portal) no prueba que quien llama pasó la pantalla de PIN — mismo
// hallazgo ya cerrado en portal-analysis (hwg-app#19/#20), extendido acá a
// los 4 endpoints de escritura del portal con resolvePortalWriter
// (api/_portal.js): hace falta portal_pin, o la sesión del ATS de un owner.

const bearer = (role) => ({ authorization: 'Bearer ' + jwt.sign({ id: 1, email: 'a@b.c', role }, 'test-secret') });

test('notify: sin portal_token ni PIN → 403 y no manda mail', async () => {
  const r = await call(notify, { title: 'Dev' });
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

// Paso 1/3 (Greptile en #25): con required:false, portal_token sin PIN
// todavía funciona — igual que antes de este PR — mientras el ATS que
// manda el PIN (hwg_ats#64) termina de deployarse. El paso 3 (aparte)
// pasa a required:true y este caso vuelve a dar 401.
test('notify: portal_token sin PIN todavía funciona (paso 1/3 — required:false)', async () => {
  const r = await call(notify, { portal_token: 'PORTAL_OK', title: 'Dev' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mails.length, 1);
});

test('notify: PIN incorrecto → 403 y no manda mail', async () => {
  const r = await call(notify, { portal_token: 'PORTAL_OK', portal_pin: '0000', title: 'Dev' });
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify: portal inactivo (con PIN correcto de esa fila) → 403 y no manda mail', async () => {
  const r = await call(notify, { portal_token: 'PORTAL_INACTIVO', portal_pin: '1234', title: 'Dev' });
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify: sesión del owner sin PIN también sirve (bypass del portal)', async () => {
  const r = await call(notify, { portal_token: 'PORTAL_OK', title: 'Dev' }, { headers: bearer('owner') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mails.length, 1);
});

test('notify: sesión de recruiter (no owner) no alcanza — el bypass del portal es solo para el owner', async () => {
  const r = await call(notify, { portal_token: 'PORTAL_OK', title: 'Dev' }, { headers: bearer('recruiter') });
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify: destinatarios fijos, cliente de la base, HTML escapado', async () => {
  const r = await call(notify, {
    portal_token: 'PORTAL_OK', portal_pin: '1234', title: 'Dev ' + EVIL, jd_text: EVIL,
    clientName: 'NOMBRE FALSO', notification_email: 'atacante@evil.example',
  });
  assert.equal(r.status, 200);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['josie@hwgtalent.com', 'josefina.rodriguez.castells@gmail.com']);
  assert.ok(mails[0].html.includes('Acme &amp; Co'));
  assert.ok(!mails[0].html.includes('NOMBRE FALSO'));
  assert.ok(!mails[0].html.includes('<a href="https://evil.example"'));
  assert.ok(!/[\r\n]/.test(mails[0].subject));
});

// ── notify-message (mensaje al recruiter) ─────────────────────────────────

const msg = (extra) => ({ portal_token: 'PORTAL_OK', portal_pin: '1234', to: 'rec.uno@hwgtalent.com', fromEmail: 'hm@acme.example', message: 'hola', ...extra });

test('notify-message: sin portal_token ni PIN → 403 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ portal_token: undefined, portal_pin: undefined }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

// Paso 1/3 — ver el comentario en la sección de notify, arriba.
test('notify-message: portal_token sin PIN todavía funciona (paso 1/3 — required:false)', async () => {
  const r = await call(notifyMessage, msg({ portal_pin: undefined }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mails.length, 1);
});

test('notify-message: PIN incorrecto → 403 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ portal_pin: '0000' }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify-message: portal inactivo (con PIN correcto de esa fila) → 403 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ portal_token: 'PORTAL_INACTIVO' }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify-message: sesión del owner sin PIN también sirve', async () => {
  const r = await call(notifyMessage, msg({ portal_pin: undefined }), { headers: bearer('owner') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mails.length, 1);
});

test('notify-message: destinatario ajeno (no es recruiter) → 403 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ to: 'victima@gmail.example' }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify-message: recruiter de OTRO cliente → 403 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ to: 'rec.otro@hwgtalent.com' }));
  assert.equal(r.status, 403);
  assert.equal(mails.length, 0);
});

test('notify-message: fromEmail inválido → 400 y no manda mail', async () => {
  const r = await call(notifyMessage, msg({ fromEmail: 'no-es-un-mail' }));
  assert.equal(r.status, 400);
  assert.equal(mails.length, 0);
});

test('notify-message: recruiter del cliente (sin distinguir mayúsculas) → manda, con datos de la base y HTML escapado', async () => {
  const r = await call(notifyMessage, msg({ to: 'REC.UNO@hwgtalent.com', recruiterName: 'NOMBRE FALSO', message: 'hola ' + EVIL }));
  assert.equal(r.status, 200);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['Rec.Uno@hwgtalent.com', 'josie@hwgtalent.com']);
  assert.equal(mails[0].reply_to, 'hm@acme.example');
  assert.ok(mails[0].html.includes('Rec Uno'));
  assert.ok(!mails[0].html.includes('NOMBRE FALSO'));
  assert.ok(!mails[0].html.includes('<a href="https://evil.example"'));
});

test('notify-message: mail con "_" y muchos usuarios parecidos (comodín de ilike) → igual encuentra a la recruiter', async () => {
  // 60 usuarios que el "_" de ilike también matchea (rec_a → recXa, recYa…)
  // y la recruiter real al final: con un limit, quedaba afuera.
  const extra = Array.from({ length: 60 }, (_, i) => ({ id: 'x' + i, email: `rec${String.fromCharCode(65 + (i % 26))}${i}a@hwgtalent.com`.replace(/\d+a@/, 'a@'), name: 'X' + i }));
  DB.users.unshift(...extra);
  DB.users.push({ id: 'u_', email: 'rec_a@hwgtalent.com', name: 'Rec Guion' });
  DB.position_recruiters.push({ position_id: 'p1', recruiter_id: 'u_' });
  try {
    const r = await call(notifyMessage, msg({ to: 'rec_a@hwgtalent.com' }));
    assert.equal(r.status, 200);
    assert.deepEqual(mails[0].to, ['rec_a@hwgtalent.com', 'josie@hwgtalent.com']);
  } finally {
    DB.users.splice(0, extra.length); DB.users.pop(); DB.position_recruiters.pop();
  }
});

test('notify GET (Admin → Config): solo owner ve la lista de destinatarios', async () => {
  assert.equal((await call(notify, undefined, { method: 'GET' })).status, 401);
  assert.equal((await call(notify, undefined, { method: 'GET', headers: bearer('recruiter') })).status, 403);
  const r = await call(notify, undefined, { method: 'GET', headers: bearer('owner') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.recipients, ['josie@hwgtalent.com', 'josefina.rodriguez.castells@gmail.com']);
  assert.equal(mails.length, 0);
});
