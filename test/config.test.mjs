// api/config.js: configuración pública de las páginas sueltas. No debe devolver ninguna clave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = require('../api/config.js');

function llamar(method = 'GET') {
  const out = { headers: {}, status: null, body: null };
  const res = { setHeader: (k, v) => { out.headers[k] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, end() { return this; } };
  handler({ method }, res);
  return out;
}

test('devuelve la URL de Supabase y de la app, y ninguna clave', () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_ANON_KEY = 'eyJviejaanon.eyJx.firma'; process.env.SUPABASE_SERVICE_KEY_V2 = 'sb_secret_x';
  const r = llamar();
  assert.equal(r.status, 200);
  assert.equal(r.body.supabaseUrl, 'https://fake.supabase.co');
  assert.ok(r.body.appUrl);
  assert.ok(!('supabaseKey' in r.body));
  assert.ok(!JSON.stringify(r.body).match(/eyJ|sb_secret|sb_publishable/), 'ni la anon vieja ni ninguna otra clave');
});
test('preflight CORS responde 200', () => { assert.equal(llamar('OPTIONS').status, 200); });
