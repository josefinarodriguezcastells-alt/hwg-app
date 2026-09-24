const crypto = require('crypto');
const { requireRole } = require('./_auth');
const { findLatestForPair } = require('./_presentations');

module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Sesión del ATS: si viene, tiene que ser válida (owner/recruiter). Todavía
  // no se exige porque el ATS en producción no la manda; el paso siguiente
  // (una vez deployado el ATS que la manda) es exigirla siempre — sin eso,
  // cualquiera con un candidate_id y un position_id puede publicar un
  // informe que el portal le muestra al cliente como el vigente.
  if (req.headers?.authorization) {
    const session = requireRole(req, res, ['owner', 'recruiter']);
    if (!session) return;
  }

  try {
    const { profile_data, candidate_id, position_id, recruiter_id } = req.body;

    if (!profile_data) {
      return res.status(400).json({ error: 'profile_data es requerido' });
    }
    // Sin position_id el informe queda huérfano: invisible en la pestaña
    // Informe del candidato y en el portal del cliente (los dos filtran por
    // posición), aunque exista en la base. Mejor cortar acá con un error
    // claro que dejar una fila fantasma que nadie va a encontrar después.
    if (!candidate_id || !position_id) {
      return res.status(400).json({ error: 'candidate_id y position_id son requeridos para publicar un informe' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    };
    const appUrl = process.env.APP_URL || 'https://hwg-app.vercel.app';

    // Un informe por candidato+posición: si ya hay uno, se actualiza en el
    // lugar (mismo token, mismo link que el cliente ya pueda tener) en vez
    // de crear otro. Antes siempre insertaba, y cualquier camino del ATS
    // que llegara acá con un informe ya publicado dejaba un duplicado.
    const existing = await findLatestForPair({
      supabaseUrl: SUPABASE_URL, headers, candidateId: candidate_id, positionId: position_id, select: 'id,token',
    });
    if (existing) {
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/candidate_presentations?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ profile_data, is_published: true, updated_at: new Date().toISOString() }),
      });
      const updData = await upd.json();
      if (!upd.ok) {
        console.error('Supabase error:', updData);
        return res.status(500).json({ error: 'Error guardando en Supabase', detail: updData });
      }
      return res.status(200).json({
        token: existing.token,
        id: existing.id,
        url: `${appUrl}/perfil?token=${existing.token}`,
        updated: true,
      });
    }

    // Token único legible: nombre-empresa-hash corto
    const name = (profile_data.name || 'candidato')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const company = (profile_data.role || 'hwg')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 20);

    const hash = crypto.randomBytes(4).toString('hex');
    const token = `${name}-${company}-${hash}`;

    const payload = {
      token,
      profile_data,
      candidate_id: candidate_id || null,
      position_id: position_id || null,
      recruiter_id: recruiter_id || null,
      is_published: true,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/candidate_presentations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Supabase error:', result);
      return res.status(500).json({ error: 'Error guardando en Supabase', detail: result });
    }

    const saved = Array.isArray(result) ? result[0] : result;

    return res.status(200).json({
      token: saved.token,
      id: saved.id,
      url: `${appUrl}/perfil?token=${saved.token}`,
    });

  } catch (e) {
    console.error('save-profile error:', e);
    return res.status(500).json({ error: e.message });
  }
};
