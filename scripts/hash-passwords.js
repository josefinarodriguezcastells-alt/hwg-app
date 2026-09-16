// One-time migration: hashea con bcrypt las contraseñas en texto plano de la
// tabla `users`. Idempotente — si una fila ya tiene un hash bcrypt (empieza
// con "$2"), la salta.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/hash-passwords.js
//
// Correr UNA vez, después de deployar api/login.js y ANTES de sacar el login
// viejo (que compara texto plano) del index.html del ATS.

const bcrypt = require('bcryptjs');

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Faltan las env vars SUPABASE_URL y/o SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,email,password`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!resp.ok) {
    console.error('No se pudo leer la tabla users:', await resp.text());
    process.exit(1);
  }

  const users = await resp.json();
  console.log(`${users.length} usuarios encontrados.`);

  for (const u of users) {
    if (!u.password) {
      console.log(`- ${u.email}: sin password, salteado`);
      continue;
    }
    if (u.password.startsWith('$2')) {
      console.log(`- ${u.email}: ya hasheado, salteado`);
      continue;
    }

    const hash = await bcrypt.hash(u.password, 10);
    const upd = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${u.id}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ password: hash }),
    });

    if (!upd.ok) {
      console.error(`- ${u.email}: FALLÓ el update —`, await upd.text());
    } else {
      console.log(`- ${u.email}: hasheado OK`);
    }
  }

  console.log('Listo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
