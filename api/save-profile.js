const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { profile_data, candidate_id, position_id, recruiter_id } = req.body;

    if (!profile_data) {
      return res.status(400).json({ error: 'profile_data es requerido' });
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
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation',
      },
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
      url: `${process.env.APP_URL || 'https://hwg-app.vercel.app'}/perfil?token=${saved.token}`,
    });

  } catch (e) {
    console.error('save-profile error:', e);
    return res.status(500).json({ error: e.message });
  }
};
