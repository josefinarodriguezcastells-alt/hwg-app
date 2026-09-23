// api/notify-portal-feedback.js
// El cliente deja un comentario o una calificación con estrellas sobre un
// candidato desde el portal — hasta ahora eso solo se guardaba en Supabase
// (client_portal_notes / applications.client_rating) sin avisarle a nadie.
// Jo lo pidió puntual: "todo lo que accione desde el cliente al recruiter
// tengo que también verlo yo, por si la recruiter no está más o pasa
// algo" — mismo criterio que ya usan notify-message.js y
// portal-candidate-action.js (recruiter + copia fija a Josie).
//
// A diferencia de portal-candidate-action.js, acá no se toca ningún dato:
// el frontend ya escribió la nota/rating directo a Supabase con la clave
// anónima (RLS abierto para client_portal_notes/applications desde el
// portal). Este endpoint solo existe porque mandar mail necesita la clave
// de Resend, que es secreta — best-effort, si falla no hay nada que
// revertir.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COPY = {
  es: {
    comment: {
      subject: (candidateName, positionRole) => `Comentario del cliente: ${candidateName} — ${positionRole}`,
      title: '💬 Nuevo comentario del cliente',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} dejó un comentario sobre <strong>${candidateName}</strong> en la búsqueda de <strong>${positionRole}</strong>.`,
      detailLabel: 'Comentario',
    },
    rating: {
      subject: (candidateName, positionRole) => `Calificación del cliente: ${candidateName} — ${positionRole}`,
      title: '⭐ Nueva calificación del cliente',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} calificó a <strong>${candidateName}</strong> en la búsqueda de <strong>${positionRole}</strong>.`,
      detailLabel: 'Calificación',
    },
    cta: 'Ver en el portal →',
    footer: 'HWG Talent Consultants · Notificación automática desde el portal de clientes',
  },
  en: {
    comment: {
      subject: (candidateName, positionRole) => `Client comment: ${candidateName} — ${positionRole}`,
      title: '💬 New client comment',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} left a comment on <strong>${candidateName}</strong> for the <strong>${positionRole}</strong> search.`,
      detailLabel: 'Comment',
    },
    rating: {
      subject: (candidateName, positionRole) => `Client rating: ${candidateName} — ${positionRole}`,
      title: '⭐ New client rating',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} rated <strong>${candidateName}</strong> for the <strong>${positionRole}</strong> search.`,
      detailLabel: 'Rating',
    },
    cta: 'View in portal →',
    footer: 'HWG Talent Consultants · Automatic notification from the client portal',
  },
};

function buildEmailHtml(t, kind, candidateName, positionRole, clientName, detailText, ctaUrl) {
  const c = t[kind];
  candidateName = escapeHtml(candidateName);
  positionRole = escapeHtml(positionRole);
  clientName = escapeHtml(clientName);
  detailText = escapeHtml(detailText);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#7c3aed;padding:24px 32px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${c.title}</div>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;font-size:14px;color:#111827;line-height:1.6;">${c.body(candidateName, positionRole, clientName)}</p>
      ${detailText ? `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${c.detailLabel}</div>
        <div style="font-size:14px;color:#111827;white-space:pre-wrap;">${detailText}</div>
      </div>` : ''}
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${ctaUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">${c.cta}</a>
      </div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">${t.footer}</div>
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { portal_token, position_id, kind, detail, lang } = req.body || {};
  if (!portal_token || !position_id || !['comment', 'rating'].includes(kind)) {
    return res.status(400).json({ error: 'Faltan datos (portal_token, position_id, kind)' });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(position_id)) return res.status(400).json({ error: 'position_id inválido' });
  const detailText = typeof detail === 'string' ? detail.trim().slice(0, 2000) : '';
  const candidateName = typeof req.body.candidate_name === 'string' ? req.body.candidate_name.trim().slice(0, 200) : '';

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  if (!RESEND_API_KEY) {
    // Best-effort — el dato del cliente ya se guardó en Supabase desde el
    // frontend antes de llamar acá, así que "no se pudo avisar" no debe
    // leerse como "no se pudo guardar".
    return res.status(200).json({ ok: true, skipped: 'no RESEND_API_KEY' });
  }
  const baseHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

  try {
    // Mismo criterio defensivo que portal-candidate-action.js: no confiar en
    // position_id solo — hay que confirmar que pertenece al cliente dueño
    // de este portal_token antes de mandar mail a sus recruiters.
    const clientResp = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?portal_token=eq.${encodeURIComponent(portal_token)}&portal_active=eq.true&select=id,name`,
      { headers: baseHeaders }
    );
    const clientRows = await clientResp.json();
    if (!clientResp.ok) return res.status(clientResp.status).json({ error: clientRows });
    const client = Array.isArray(clientRows) ? clientRows[0] : null;
    if (!client) return res.status(403).json({ error: 'Portal inválido' });

    const posResp = await fetch(
      `${SUPABASE_URL}/rest/v1/positions?id=eq.${position_id}&client_id=eq.${client.id}&select=id,role`,
      { headers: baseHeaders }
    );
    const posRows = await posResp.json();
    const position = Array.isArray(posRows) ? posRows[0] : null;
    if (!position) return res.status(403).json({ error: 'Posición inválida' });

    const recResp = await fetch(
      `${SUPABASE_URL}/rest/v1/position_recruiters?position_id=eq.${position_id}&select=recruiter_id`,
      { headers: baseHeaders }
    );
    const recRows = await recResp.json();
    const recruiterIds = [...new Set((recRows || []).map(r => r.recruiter_id).filter(Boolean))];
    let toAddresses = [];
    if (recruiterIds.length) {
      const usersResp = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=in.(${recruiterIds.join(',')})&select=email`,
        { headers: baseHeaders }
      );
      const usersRows = await usersResp.json();
      toAddresses = [...new Set((usersRows || []).map(u => u.email).filter(Boolean))];
    }
    // Si no hay recruiter asignado todavía, igual le llega a Josie — ella
    // pidió específicamente enterarse aunque "la recruiter no esté más".
    if (!toAddresses.length) toAddresses = ['josie@hwgtalent.com'];

    const t = COPY[lang === 'en' ? 'en' : 'es'];
    const ctaUrl = `https://hwgats.vercel.app/portal/${portal_token}`;
    const html = buildEmailHtml(t, kind, candidateName || (lang === 'en' ? 'a candidate' : 'un candidato'), position.role || '', client.name || '', detailText, ctaUrl);
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'HWG Talent Consultants <notificaciones@hwgtalent.com>',
        to: toAddresses,
        cc: 'josie@hwgtalent.com',
        subject: t[kind].subject(candidateName || (lang === 'en' ? 'a candidate' : 'un candidato'), position.role || ''),
        html,
      }),
    });
    if (!emailResp.ok) {
      const emailErr = await emailResp.json().catch(() => ({}));
      console.error('notify-portal-feedback: Resend error', emailErr);
      return res.status(200).json({ ok: true, mailFailed: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('notify-portal-feedback error:', e);
    // Best-effort: el dato del cliente ya está guardado, no hacemos que el
    // frontend muestre un error por una notificación que falló.
    return res.status(200).json({ ok: true, mailFailed: true });
  }
};
