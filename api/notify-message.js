// api/notify-message.js
// Un cliente le escribe a su recruiter desde el portal. Se manda vía Resend
// en vez de mailto — así el mail sale siempre, con copia a josie@hwgtalent.com
// garantizada del lado del servidor (no depende de que el cliente tenga un
// programa de mail configurado ni de que no borre el CC antes de mandar).
//
// Solo con un portal activo (portal_token), y solo a un recruiter asignado
// a una posición de ESE cliente: antes `to` venía del pedido, así que
// cualquiera con la URL podía mandar mails a cualquier dirección desde la
// casilla de HWG. El mensaje se escapa antes de ir al HTML.

import { EMAIL_RE, escapeHtml, resolvePortalWriter, findClientRecruiter } from './_portal.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { portal_token, portal_pin, to, fromEmail, message } = req.body || {};

    const text = String(message ?? '').trim().slice(0, 5000);
    const from = String(fromEmail ?? '').trim();
    if (!to || !text || !EMAIL_RE.test(from) || from.length > 200) {
      return res.status(400).json({ error: 'Faltan datos (to, fromEmail, message)' });
    }

    const client = await resolvePortalWriter(req, res, portal_token, portal_pin, { required: false }); // paso 1/3, ver _portal.js
    if (!client) return;
    const recruiter = await findClientRecruiter(client.id, to);
    if (!recruiter) return res.status(403).json({ error: 'Ese destinatario no es un recruiter de este cliente' });

    // Nombres desde la base, no del pedido.
    const clientName = client.name || '';
    const recruiterName = recruiter.name || '';

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
    }

    // Copia fija a Josie — no es editable desde el portal.
    const toAddresses = [...new Set([recruiter.email, 'josie@hwgtalent.com'])];

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <div style="background:#7c3aed;padding:24px 32px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">✉ Mensaje desde el portal</div>
      <div style="font-size:13px;color:#ede9fe;margin-top:4px;">De ${escapeHtml(clientName || 'un cliente')} (${escapeHtml(from)})${recruiterName ? ` para ${escapeHtml(recruiterName)}` : ''}</div>
    </div>

    <div style="padding:28px 32px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:14px;color:#111827;white-space:pre-wrap;line-height:1.6;">${escapeHtml(text)}</div>

      <div style="margin-top:20px;font-size:12px;color:#6b7280;">
        Respondé directamente a este mail — llega a ${escapeHtml(from)}.
      </div>
    </div>

    <div style="padding:16px 32px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
      HWG Talent · Mensaje enviado desde el portal de clientes
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
        from: 'HWG ATS <notificaciones@hwgtalent.com>',
        to: toAddresses,
        reply_to: from,
        subject: `[Portal] Mensaje de ${clientName || 'un cliente'}${recruiterName ? ' para ' + recruiterName : ''}`.replace(/[\r\n]+/g, ' '),
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
    console.error('notify-message error:', err);
    return res.status(500).json({ error: err.message });
  }
}
