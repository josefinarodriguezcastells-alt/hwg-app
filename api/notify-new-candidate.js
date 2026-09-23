// api/notify-new-candidate.js
// El recruiter, al publicar un informe (que ya deja al candidato en
// 'submitted'), puede elegir avisarle al cliente por mail. Va al/a los
// mail(es) de contacto del cliente (clients.stakeholder[].email), con
// copia fija a josie@hwgtalent.com y reply-to al mail real del recruiter
// a cargo — así si el hiring manager responde, le llega a quien está
// llevando la búsqueda, no a una casilla sin dueño. `lang` lo elige el
// recruiter a mano en el momento de mandar (no se infiere) porque hay
// clientes en inglés y no hay ningún campo de idioma guardado por cliente.

const COPY = {
  es: {
    preheader: (pos, client) => `${pos} — ${client}`,
    title: '👤 Nuevo candidato presentado',
    greeting: (name) => `Hola ${name || ''},`.trim(),
    body: (candidateName, positionRole) =>
      `Tenemos un nuevo candidato para tu revisión: <strong>${candidateName}</strong>, para la búsqueda de <strong>${positionRole}</strong>.`,
    salaryLabel: 'Salario pretendido',
    cta: 'Ver informe completo →',
    portalCta: 'Ir a tu portal →',
    closing: 'Aguardamos tus comentarios.',
    signoff: 'Saludos,<br/>HWG Team',
    footer: 'HWG Talent Consultants · Notificación automática desde el portal de clientes',
    subject: (positionRole, candidateName) => `${positionRole} - ${candidateName} - HWG Talent Consultants`,
  },
  en: {
    preheader: (pos, client) => `${pos} — ${client}`,
    title: '👤 New candidate submitted',
    greeting: (name) => `Hi ${name || ''},`.trim(),
    body: (candidateName, positionRole) =>
      `We have a new candidate for your review: <strong>${candidateName}</strong>, for the <strong>${positionRole}</strong> search.`,
    salaryLabel: 'Expected salary',
    cta: 'View full report →',
    portalCta: 'Go to your portal →',
    closing: "We're looking forward to your feedback.",
    signoff: 'Best,<br/>HWG Team',
    footer: 'HWG Talent Consultants · Automatic notification from the client portal',
    subject: (positionRole, candidateName) => `${positionRole} - ${candidateName} - HWG Talent Consultants`,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      to,                 // string[] — mails de los stakeholders del cliente
      hmName,             // nombre del hiring manager (si hay uno solo/principal), opcional
      candidateName,
      positionRole,
      clientName,
      salaryExpected,     // opcional
      informeUrl,         // link directo al informe publicado del candidato
      portalUrl,          // link al portal del cliente
      recruiterEmail,     // reply-to
      lang,               // 'es' | 'en', elegido por el recruiter
    } = req.body;

    if (!Array.isArray(to) || to.length === 0 || !candidateName || !positionRole || !portalUrl || !recruiterEmail) {
      return res.status(400).json({ error: 'Faltan datos (to, candidateName, positionRole, portalUrl, recruiterEmail)' });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
    }

    const t = COPY[lang === 'en' ? 'en' : 'es'];
    const toAddresses = [...new Set(to)];

    const salarySection = salaryExpected ? `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${t.salaryLabel}</div>
        <div style="font-size:16px;color:#111827;font-weight:600;">${salaryExpected}</div>
      </div>` : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <div style="background:#7c3aed;padding:24px 32px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${t.title}</div>
      <div style="font-size:13px;color:#ede9fe;margin-top:4px;">${t.preheader(positionRole, clientName || '')}</div>
    </div>

    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:14px;color:#111827;line-height:1.6;">${t.greeting(hmName)}</p>
      <p style="margin:0 0 20px;font-size:14px;color:#111827;line-height:1.6;">${t.body(candidateName, positionRole)}</p>

      ${salarySection}

      <div style="text-align:center;margin-bottom:${informeUrl ? '10px' : '8px'};">
        <a href="${informeUrl || portalUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          ${t.cta}
        </a>
      </div>
      ${informeUrl ? `
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${portalUrl}" style="color:#7c3aed;font-size:12px;text-decoration:none;">${t.portalCta}</a>
      </div>` : ''}

      <p style="margin:24px 0 0;font-size:14px;color:#111827;line-height:1.6;">${t.closing}</p>
      <p style="margin:16px 0 0;font-size:14px;color:#111827;line-height:1.6;">${t.signoff}</p>
    </div>

    <div style="padding:16px 32px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
      ${t.footer}
    </div>
  </div>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'HWG Talent Consultants <notificaciones@hwgtalent.com>',
        to: toAddresses,
        cc: 'josie@hwgtalent.com',
        reply_to: recruiterEmail,
        subject: t.subject(positionRole, candidateName),
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data.message || 'Error al enviar mail' });
    }

    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error('notify-new-candidate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
