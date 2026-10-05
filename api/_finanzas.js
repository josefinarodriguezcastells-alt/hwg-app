// Reglas compartidas del módulo Finanzas en el servidor.

// Tablas que, con el PIN de Finanzas activo, exigen el token X-Finanzas-Token.
// entidades_facturadoras queda afuera a propósito: se administra desde Admin,
// no desde Finanzas. billing POST también queda afuera (ver owner-data.js):
// cualquier recruiter crea el registro al confirmar un hire.
const FINANZAS_TABLES = new Set([
  'billing',
  'facturas',
  'embedded_nomina_personas',
  'embedded_nomina',
  'finanzas_log',
]);

// Tablas cuyos cambios quedan en finanzas_log (quién, cuándo, antes/después).
const LOGGED_TABLES = new Set([
  'billing',
  'facturas',
  'embedded_nomina_personas',
  'embedded_nomina',
]);

// Si es false, el servidor acepta pedidos sin token de Finanzas (período de
// transición mientras el frontend nuevo —que lo manda— se despliega). Se pasa
// a true en un segundo paso, ya verificado.
// FINANZAS_PIN_ENFORCE=1/0 en el entorno lo fuerza (los tests lo usan).
const ENFORCE_PIN = process.env.FINANZAS_PIN_ENFORCE !== undefined ? process.env.FINANZAS_PIN_ENFORCE === '1' : false;

// Campos que cambian de verdad con un PATCH: { antes: {campo: valorViejo},
// despues: {campo: valorNuevo} }. Compara como texto para que 5 y "5" no
// cuenten como cambio, y null y "" tampoco. `updated_at` se ignora.
function cambios(fila, body) {
  const norm = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const antes = {}, despues = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (k === 'updated_at') continue;
    if (norm(fila[k]) !== norm(v)) { antes[k] = fila[k] ?? null; despues[k] = v ?? null; }
  }
  return { antes, despues };
}

// Filas de log para un PATCH sobre varias filas. Devuelve [] si nada cambió.
function filasLogPatch({ tabla, filas, body, usuario }) {
  const out = [];
  for (const fila of filas) {
    const { antes, despues } = cambios(fila, body);
    if (!Object.keys(despues).length) continue;
    out.push({
      user_id: usuario.id, user_name: usuario.email, tabla, row_id: String(fila.id),
      accion: 'estado' in despues ? 'estado' : 'editar', antes, despues,
    });
  }
  return out;
}

module.exports = { FINANZAS_TABLES, LOGGED_TABLES, ENFORCE_PIN, cambios, filasLogPatch };
