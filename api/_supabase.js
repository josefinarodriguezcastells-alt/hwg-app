// Clave de servicio de Supabase y cómo se manda en cada pedido.
//
// Hay dos formatos y el servidor entiende los dos, para poder rotar sin cortar nada:
//  - clave "legacy" (un JWT que empieza con eyJ): va en `apikey` y en `Authorization: Bearer`.
//  - clave "secreta" nueva (sb_secret_…): NO es un JWT. Supabase exige mandarla SOLO en
//    `apikey`; si va también como Bearer, el pedido falla.
//
// La variable SUPABASE_SERVICE_KEY_V2 tiene prioridad sobre SUPABASE_SERVICE_KEY. Así la
// clave nueva se prueba sin perder la vieja: para volver atrás basta borrar la V2.

function claveServicio() {
  return process.env.SUPABASE_SERVICE_KEY_V2 || process.env.SUPABASE_SERVICE_KEY || undefined;
}

// Cabeceras para hablar con Supabase como servidor. `extra` se suma (Content-Type, Prefer…).
function cabecerasServicio(extra = {}) {
  const k = claveServicio();
  const h = { apikey: k };
  if (typeof k === 'string' && k.startsWith('eyJ')) h.Authorization = `Bearer ${k}`;
  return { ...h, ...extra };
}

module.exports = { claveServicio, cabecerasServicio };
