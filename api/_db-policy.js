// Reglas del proxy de datos (api/db.js), sin dependencias para poder testearlas.
//
// El proxy reenvía a PostgREST con la clave de servicio (que ignora RLS), así
// que TODA la seguridad tiene que estar acá: qué tablas, qué roles, y qué se
// puede "incrustar" en un select. Sin esto último, un pedido autenticado como
// `applications?select=*,billing(*)` o `...,users(password)` leería, con la
// clave de servicio, datos que nada tienen que ver con la tabla pedida
// (facturación, hashes de contraseñas, PINs).

// Tablas que se leen/escriben por el proxy, y quién puede.
//   rw: roles que pueden escribir (POST/PATCH/DELETE). Leer: siempre owner y recruiter.
const TABLAS = {
  candidates: { rw: ['owner', 'recruiter'] },
  candidate_documents: { rw: ['owner', 'recruiter'] },
  applications: { rw: ['owner', 'recruiter'] },
  positions: { rw: ['owner', 'recruiter'] },
  position_recruiters: { rw: ['owner', 'recruiter'] },
  scorecards: { rw: ['owner', 'recruiter'] },
  scorecard_templates: { rw: ['owner', 'recruiter'] },
  status_history: { rw: ['owner', 'recruiter'] },
  client_portal_visibility: { rw: ['owner', 'recruiter'] },
  client_portal_notes: { rw: ['owner', 'recruiter'] },
  client_portal_activity: { rw: ['owner', 'recruiter'] },
  client_position_requests: { rw: ['owner', 'recruiter'] },
  // clients: los recruiters leen solo clientes (no leads) y no escriben.
  clients: { rw: ['owner'], recruiterSoloClientes: true },
};

// Relaciones que se pueden incrustar en un select (las mismas tablas, más
// `users` con columnas limitadas). Cualquier otra se rechaza.
const INCRUSTABLES = new Set(Object.keys(TABLAS));
const USERS_COLUMNAS = new Set(['id', 'name', 'email', 'role']);

// Devuelve null si el select es válido, o el motivo del rechazo.
function validarSelect(select) {
  if (select === undefined || select === null || select === '') return null;
  const s = String(select);
  // Cada "(" abre una relación incrustada o una lista de columnas. Se recorre
  // con una pila para leer el nombre de la relación y su contenido directo.
  const pila = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      // nombre = lo que está pegado antes del paréntesis (puede traer alias:, !hint, !inner)
      const antes = s.slice(0, i).match(/([A-Za-z0-9_]+:)?([A-Za-z0-9_]+)(![A-Za-z0-9_]+)*$/);
      if (!antes) return 'select inválido';
      const relacion = antes[2];
      pila.push({ relacion, inicio: i + 1 });
    } else if (c === ')') {
      const abierta = pila.pop();
      if (!abierta) return 'select inválido (paréntesis)';
      const { relacion } = abierta;
      if (relacion === 'users') {
        const interior = s.slice(abierta.inicio, i);
        // `users` solo con columnas simples y permitidas (sin * ni más incrustados)
        if (interior.includes('(')) return 'users no admite relaciones anidadas';
        const cols = interior.split(',').map((x) => x.trim().replace(/^[A-Za-z0-9_]+:/, ''));
        if (!cols.length || cols.some((x) => !USERS_COLUMNAS.has(x))) return 'users solo admite id, name, email y role';
      } else if (!INCRUSTABLES.has(relacion)) {
        return `no se puede incrustar ${relacion}`;
      }
    }
    i++;
  }
  if (pila.length) return 'select inválido (paréntesis sin cerrar)';
  return null;
}

// Arma el querystring que se manda a PostgREST. `entrada` es URLSearchParams
// de lo que mandó el cliente (sin el parámetro propio del proxy).
// Devuelve { error } o { query }.
function armarConsulta({ tabla, rol, metodo, entrada }) {
  const cfg = TABLAS[tabla];
  if (!cfg) return { error: 'Tabla no permitida', status: 400 };
  const esLectura = metodo === 'GET' || metodo === 'HEAD';
  if (!esLectura && !cfg.rw.includes(rol)) return { error: 'No tenés permiso para modificar esta tabla', status: 403 };

  const q = new URLSearchParams(entrada);
  const motivo = validarSelect(q.get('select'));
  if (motivo) return { error: motivo, status: 400 };
  // Los filtros pueden ir sobre columnas incrustadas pero no pedir relaciones
  // nuevas: `order`/`or`/`and` con "(" de relaciones no se interpretan como
  // select, pero igual se revisa que ningún valor mencione tablas bloqueadas
  // como relación (p. ej. order=billing(fee)).
  for (const [k, v] of q) {
    if (k === 'select') continue;
    if (/(^|[^A-Za-z0-9_])(billing|facturas|embedded_nomina|embedded_nomina_personas|client_secrets|client_stakeholders|lead_contacts|finanzas_log|tipo_cambio|client_finanzas|app_settings|login_attempts|users)\s*[.(]/.test(`${k}=${v}`)) {
      if (!/^(select)$/.test(k)) return { error: 'Parámetro no permitido', status: 400 };
    }
  }
  if (cfg.recruiterSoloClientes && rol === 'recruiter') q.set('is_lead', 'eq.false');
  return { query: q.toString() };
}

module.exports = { TABLAS, INCRUSTABLES, validarSelect, armarConsulta };
