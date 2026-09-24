// Helpers compartidos sobre candidate_presentations.
//
// Regla: hay UN informe por candidato+posición — el más reciente por
// published_at. Es el que muestran el ATS (CandidateProfile →
// presByPosition) y el portal (ClientPortal → presLinks). Por un bug ya
// arreglado (hwg_ats#50) quedaron filas duplicadas, y un cliente puede
// tener guardado el link viejo; estos helpers hacen que esas filas viejas
// resuelvan siempre al informe vigente, y que no se creen más duplicados.

// Informe vigente de un candidato para una posición, o null.
async function findLatestForPair({ supabaseUrl, headers, candidateId, positionId, select = '*' }) {
  if (!candidateId || !positionId) return null;
  const url = `${supabaseUrl}/rest/v1/candidate_presentations`
    + `?candidate_id=eq.${encodeURIComponent(candidateId)}`
    + `&position_id=eq.${encodeURIComponent(positionId)}`
    + `&select=${select}&order=published_at.desc&limit=1`;
  const resp = await fetch(url, { headers });
  const data = await resp.json();
  if (!resp.ok) throw new Error(typeof data === 'object' ? JSON.stringify(data) : String(data));
  return Array.isArray(data) && data[0] ? data[0] : null;
}

module.exports = { findLatestForPair };
