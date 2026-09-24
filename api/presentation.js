// api/presentation.js
// Endpoint público (sin login) para el link "compartible" de un informe de
// candidato — reemplaza el fetch directo a Supabase con la clave anónima
// que hacía perfil.html (2026-09-22, hallazgo de seguridad: con la clave
// anónima sola, cualquiera podía además listar TODA la tabla, no solo la
// fila de un token puntual).
//
// La seguridad acá es la misma que ya tenía el link (un token largo y
// aleatorio hace de "contraseña" del link, como un link de Google Docs) —
// lo que cambia es que ahora Supabase exige la service key para esta
// tabla, así que ya no se puede pedir la tabla entera sin un token exacto.
//
// Un link viejo muestra siempre el informe vigente: si el token es de una
// fila anterior del mismo candidato+posición (duplicados de antes de
// hwg_ats#50, o un link que el cliente guardó), se devuelve la más nueva.
// Así el cliente nunca ve una versión desactualizada aunque use el link
// del primer mail.

const { findLatestForPair } = require('./_presentations');

async function findByToken(supabaseUrl, headers, token) {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/candidate_presentations?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers }
  );
  const data = await resp.json();
  if (!resp.ok) { const e = new Error('supabase'); e.status = resp.status; e.detail = data; throw e; }
  return Array.isArray(data) ? data[0] || null : data;
}

// La fila que corresponde mostrar para este token: la vigente de su
// candidato+posición, o la propia si no tiene par (informes huérfanos).
async function resolveCurrent(supabaseUrl, headers, token) {
  const row = await findByToken(supabaseUrl, headers, token);
  if (!row) return null;
  const latest = await findLatestForPair({ supabaseUrl, headers, candidateId: row.candidate_id, positionId: row.position_id });
  return latest || row;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Falta el token' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  const baseHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

  try {
    if (req.method === 'GET') {
      const row = await resolveCurrent(SUPABASE_URL, baseHeaders, token);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      return res.status(200).json(row);
    }

    if (req.method === 'PATCH') {
      // Usado por perfil.html para marcar viewed_at cuando el cliente abre
      // el link — el único campo que este endpoint público puede tocar. Se
      // marca la fila que efectivamente se mostró (la vigente).
      const row = await resolveCurrent(SUPABASE_URL, baseHeaders, token);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/candidate_presentations?id=eq.${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewed_at: new Date().toISOString() }),
        }
      );
      if (!resp.ok) { const t = await resp.text(); return res.status(resp.status).json({ error: t }); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('presentation error:', e);
    if (e.status) return res.status(e.status).json({ error: e.detail });
    return res.status(500).json({ error: e.message });
  }
};
