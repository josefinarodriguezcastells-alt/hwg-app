// Reglas del proxy del portal de clientes (api/portal-db.js), sin dependencias
// para poder testearlas. El portal no tiene sesión del ATS: el visitante
// entra con el link (portal_token) y el PIN, y el servidor le entrega una
// sesión corta de portal ({kind:'portal', cid}). Todo pedido del portal se
// fuerza a ese cliente: nunca se confía en ids ni filtros que mande el
// navegador. Mismas columnas y escrituras que ClientPortal.jsx usa hoy.

const POSITIONS_COLS = ['id', 'role', 'status', 'location', 'salary_band', 'opened_at', 'closed_at', 'client_id', 'ai_analysis', 'ai_analysis_updated_at', 'jd_structured', 'tipo'];
const APPLICATIONS_COLS = ['id', 'status', 'last_updated', 'candidate_id', 'position_id', 'rejection_motivo', 'rejection_quien', 'rejection_salary_gap_pct',
  'start_date', 'client_rating', 'first_presented_at', 'max_stage_rank', 'salario_bruto_cerrado', 'stakeholder_seguimiento'];
// NO está: applications.notes (comentarios internos del recruiter, ver MotivoRechazoModal).
const CANDIDATES_BASE = ['id', 'name'];
const CLIENTS_COLS = ['id', 'name', 'portal_active', 'cultural_tags', 'cultural_comment', 'portal_permissions'];
const CLIENTS_PRE_PIN = ['id', 'name', 'portal_active'];
const POSREC_COLS = ['position_id', 'recruiter_id'];

// Qué datos de contacto de un candidato ve este cliente, según
// clients.portal_permissions (misma semántica que la pantalla: cv, linkedin,
// email y phone hay que habilitarlos; location se ve salvo que sea false).
function columnasCandidato(perms) {
  const p = perms || {};
  const cols = [...CANDIDATES_BASE];
  if (p.cv) cols.push('cv_url');
  if (p.linkedin) cols.push('linkedin_url');
  if (p.email) cols.push('email');
  if (p.phone) cols.push('phone');
  if (p.location !== false) cols.push('location');
  return cols;
}

// Lista blanca de columnas de lectura por tabla. null = todas (tablas propias
// del cliente, filtradas por client_id).
function columnasLectura(tabla, perms, preLogin) {
  switch (tabla) {
    case 'positions': return POSITIONS_COLS;
    case 'applications': return APPLICATIONS_COLS;
    case 'candidates': return columnasCandidato(perms);
    case 'clients': return preLogin ? CLIENTS_PRE_PIN : CLIENTS_COLS;
    case 'position_recruiters': return POSREC_COLS;
    case 'client_portal_visibility': case 'client_portal_notes': case 'client_portal_activity': case 'client_position_requests': return null;
    default: return undefined; // tabla no permitida
  }
}

// Reescribe el select para que solo pida columnas permitidas. '*' o vacío →
// todas las permitidas. Una columna no permitida se descarta (la pantalla la
// recibe como undefined, igual que si el cliente no tuviera ese permiso).
// Cualquier relación incrustada "(" se rechaza. Devuelve { select } o { error }.
function restringirSelect(select, permitidas) {
  const s = select === undefined || select === null ? '*' : String(select);
  if (s.includes('(')) return { error: 'No se permiten relaciones en el portal' };
  if (permitidas === null) return { select: s };
  const pedidas = s.trim() === '*' || s.trim() === '' ? permitidas : s.split(',').map((x) => x.trim()).filter(Boolean);
  const validas = pedidas.filter((c) => permitidas.includes(c));
  if (!validas.length) return { error: 'Sin columnas permitidas' };
  return { select: validas.join(',') };
}

// Los filtros y el orden también pueden "preguntar" por columnas que no se
// devuelven (applications.notes ilike '%salario%', candidates.email = x): un
// oráculo para deducir su contenido. Solo se aceptan columnas permitidas de la
// tabla (en las tablas propias del cliente, cualquiera). Devuelve el motivo o null.
const PARAMS_LIBRES = new Set(['select', 'limit', 'offset']);
function validarFiltros(q, permitidas) {
  if (permitidas === null) return null;
  const ok = (col) => permitidas.includes(col);
  for (const [k, v] of q) {
    if (PARAMS_LIBRES.has(k)) continue;
    if (k === 'order') {
      for (const parte of String(v).split(',')) if (!ok(parte.trim().split('.')[0])) return `No se puede ordenar por ${parte.trim().split('.')[0]}`;
    } else if (k === 'or' || k === 'and') {
      for (const m of String(v).matchAll(/(?:^|[(,])\s*(?:not\.)?([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z]/g)) if (!ok(m[1])) return `No se puede filtrar por ${m[1]}`;
      if (/(^|[(,])\s*[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_]+\(/.test(String(v))) return 'Filtro no permitido';
    } else if (!ok(k)) {
      return `No se puede filtrar por ${k}`;
    }
  }
  return null;
}

const TABLAS_LECTURA = ['positions', 'applications', 'candidates', 'clients', 'position_recruiters', 'client_portal_visibility', 'client_portal_notes', 'client_portal_activity', 'client_position_requests'];

// Escrituras que el portal hace hoy. Devuelve { body } saneado o { error }.
//  - los campos que identifican al cliente se FUERZAN acá, no se leen del pedido
//  - solo las columnas listadas (nada de status, notes internos, etc.)
const COLS_ACTIVITY = ['candidate_id', 'action', 'visitor_email'];
const COLS_NOTES = ['candidate_id', 'application_id', 'note'];
const COLS_REQUEST = ['title', 'seniority', 'location', 'modality', 'salary', 'vacancies', 'start_date', 'jd_text', 'tiene_bono', 'descripcion_bono'];
const ACCIONES = new Set(['login', 'view', 'download']);

function elegir(obj, cols) {
  const out = {};
  for (const c of cols) if (obj && obj[c] !== undefined) out[c] = obj[c];
  return out;
}

function sanearEscritura({ tabla, metodo, body, cid }) {
  const filas = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : null;
  if (metodo === 'POST') {
    if (!filas || !filas.length || filas.length > 20) return { error: 'Cuerpo inválido' };
    if (tabla === 'client_portal_activity') {
      for (const f of filas) if (!ACCIONES.has(f.action)) return { error: 'Acción inválida' };
      return { body: filas.map((f) => ({ ...elegir(f, COLS_ACTIVITY), client_id: cid })) };
    }
    if (tabla === 'client_portal_notes') {
      for (const f of filas) if (typeof f.note !== 'string' || !f.note.trim() || f.note.length > 5000) return { error: 'Nota inválida' };
      return { body: filas.map((f) => ({ ...elegir(f, COLS_NOTES), client_id: cid })) };
    }
    if (tabla === 'client_position_requests') {
      return { body: filas.map((f) => ({ ...elegir(f, COLS_REQUEST), client_id: cid, status: 'pending', seen_by_admin: false })) };
    }
    return { error: 'No se permite crear en esta tabla desde el portal' };
  }
  if (metodo === 'PATCH') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Cuerpo inválido' };
    if (tabla === 'applications') {
      const claves = Object.keys(body);
      if (!claves.length || claves.some((k) => !['client_rating', 'last_updated'].includes(k))) return { error: 'Solo se puede calificar' };
      if ('client_rating' in body && body.client_rating !== null && !(Number.isInteger(body.client_rating) && body.client_rating >= 1 && body.client_rating <= 5)) return { error: 'Calificación inválida' };
      return { body: elegir(body, ['client_rating', 'last_updated']) };
    }
    if (tabla === 'clients') {
      const claves = Object.keys(body);
      if (!claves.length || claves.some((k) => !['cultural_tags', 'cultural_comment'].includes(k))) return { error: 'Solo se puede editar la cultura' };
      return { body: elegir(body, ['cultural_tags', 'cultural_comment']) };
    }
    return { error: 'No se permite modificar esta tabla desde el portal' };
  }
  return { error: 'Método no permitido' }; // DELETE: nunca desde el portal
}

module.exports = { columnasCandidato, columnasLectura, restringirSelect, validarFiltros, sanearEscritura, TABLAS_LECTURA, ACCIONES };
