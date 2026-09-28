// Greptile (PR#22): el fallback de AI_PROVIDER en extract-profile.js
// (gemini -> claude) no tenía ningún test que lo ejercitara sin la
// variable seteada — ia-auth.test.mjs la fija a 'claude' antes de importar
// el handler, así que nunca corría la rama del default. Este archivo la
// deja sin setear a propósito, en su propio proceso (node --test aísla
// cada archivo), e infiere qué proveedor se usó por a qué host salió el
// fetch — el const AI_PROVIDER es interno del módulo, no se exporta.
//
// Correr con: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

delete process.env.AI_PROVIDER;
process.env.SESSION_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'sk-fake';
process.env.GEMINI_API_KEY = 'gemini-fake';
const bearer = 'Bearer ' + jwt.sign({ id: 'u1', email: 'x@example.com', role: 'recruiter' }, process.env.SESSION_SECRET);

const realFetch = globalThis.fetch;
let calledHost = null;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  calledHost = new URL(url).host;
  if (calledHost === 'api.anthropic.com') {
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 });
  }
  if (calledHost === 'generativelanguage.googleapis.com') {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 });
  }
  throw new Error('fetch no mockeado: ' + url);
};

let server, base;
before(async () => {
  const m = await import('../api/extract-profile.js');
  const handler = m.default || m;
  server = http.createServer(async (req, res) => {
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    await handler(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server.close());

test('sin AI_PROVIDER seteada, el default es claude (no gemini)', async () => {
  const fd = new FormData();
  fd.append('cv', new Blob(['Persona X — 5 años de experiencia.'], { type: 'text/plain' }), 'cv.txt');
  const res = await fetch(base, { method: 'POST', headers: { Authorization: bearer }, body: fd });
  assert.equal(res.status, 200);
  assert.equal(calledHost, 'api.anthropic.com');
});
