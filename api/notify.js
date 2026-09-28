// api/notify.js
// Recibe los datos de un pedido de posición desde el portal cliente
// y manda un mail de notificación via Resend.
//
// Solo con un portal activo (portal_token): antes cualquiera con la URL
// podía mandar "pedidos" falsos a la casilla de HWG, agregar un
// destinatario propio (notification_email) e inyectar HTML en un mail con
// la marca de HWG. Ahora el cliente se resuelve del token, los
// destinatarios son fijos y todo lo que escribe el cliente se escapa.

import { escapeHtml, resolvePortalWriter } from './_portal.js';
import { requireRole } from './_auth.js';

const RECIPIENTS = ['josie@hwgtalent.com', 'josefina.rodriguez.castells@gmail.com'];
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  // CORS — permite llamadas desde el portal y el ATS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: a quién le llegan los pedidos — lo muestra Admin → Config en el
  // ATS, así la lista vive en un solo lugar (RECIPIENTS). Solo owner: hay
  // un mail personal en la lista.
  if (req.method === 'GET') {
    if (!requireRole(req, res, ['owner'])) return;
    return res.status(200).json({ recipients: RECIPIENTS });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      portal_token,
      portal_pin,
      title,
      seniority,
      location,
      modality,
      salary,
      vacancies,
      start_date,
      jd_text,
      tiene_bono,
      descripcion_bono,
    } = req.body || {};

    if (!clip(title, 200)) return res.status(400).json({ error: 'Falta el título de la posición' });
    const client = await resolvePortalWriter(req, res, portal_token, portal_pin, { required: false }); // paso 1/3, ver _portal.js
    if (!client) return;
    const clientName = escapeHtml(client.name);

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
    }

    const toAddresses = RECIPIENTS;

    // Filas de la tabla — solo las que tienen valor
    // Todo lo que escribe el cliente se recorta y se escapa antes del HTML.
    const vac = parseInt(vacancies, 10);
    const rows = [
      ['Posición', clip(title, 200)],
      seniority    ? ['Seniority', clip(seniority, 100)] : null,
      location     ? ['Ubicación', clip(location, 200)] : null,
      modality     ? ['Modalidad', clip(modality, 100)] : null,
      salary       ? ['Salario estimado', clip(salary, 100)] : null,
      vac > 1      ? ['Vacantes', String(Math.min(vac, 999))] : null,
      start_date   ? ['Fecha estimada de inicio', clip(start_date, 50)] : null,
      tiene_bono   ? ['¿Tiene bono?', `Sí${descripcion_bono ? ' — ' + clip(descripcion_bono, 300) : ''}`] : null,
    ].filter(Boolean).map(([label, value]) => [label, escapeHtml(value)]);

    const tableRows = rows.map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;white-space:nowrap;">${label}</td>
        <td style="padding:8px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;">${value}</td>
      </tr>`).join('');

    const jdText = escapeHtml(clip(jd_text, 20000));
    const jdSection = jdText ? `
      <div style="margin-top:24px;">
        <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Job Description</div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:13px;color:#374151;white-space:pre-wrap;line-height:1.6;">${jdText}</div>
      </div>` : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <div style="background:#7c3aed;padding:24px 32px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">🔔 Nuevo pedido de posición</div>
      <div style="font-size:13px;color:#ede9fe;margin-top:4px;">Desde el portal de ${clientName || 'un cliente'}</div>
    </div>

    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tbody>${tableRows}</tbody>
      </table>

      ${jdSection}

      <div style="margin-top:28px;">
        <a href="https://hwgats.vercel.app"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;">
          Ver en el ATS →
        </a>
      </div>
    </div>

    <div style="padding:16px 32px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
      HWG Talent · Notificación automática desde el portal de clientes
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
        reply_to: 'josie@hwgtalent.com',
        // Asunto = texto plano: sin escapar HTML, pero sin saltos de línea.
        subject: `[HWG] Nuevo pedido — ${client.name || 'Cliente'}: ${clip(title, 200)}`.replace(/[\r\n]+/g, ' '),
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
    console.error('notify-request error:', err);
    return res.status(500).json({ error: err.message });
  }
}
