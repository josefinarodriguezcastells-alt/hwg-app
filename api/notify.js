// api/notify-request.js
// Recibe los datos de un pedido de posición desde el portal cliente
// y manda un mail de notificación via Resend.

export default async function handler(req, res) {
  // CORS — permite llamadas desde el portal y el ATS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      clientName,
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
      notification_email,
    } = req.body;

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
    }

    // Destinatarios fijos + el configurado en Admin si es distinto
    const toAddresses = ['josie@hwgtalent.com', 'josefina.rodriguez.castells@gmail.com'];
    if (notification_email && !toAddresses.includes(notification_email)) {
      toAddresses.push(notification_email);
    }

    // Filas de la tabla — solo las que tienen valor
    const rows = [
      ['Posición', title],
      seniority    ? ['Seniority', seniority] : null,
      location     ? ['Ubicación', location] : null,
      modality     ? ['Modalidad', modality] : null,
      salary       ? ['Salario estimado', salary] : null,
      vacancies && vacancies > 1 ? ['Vacantes', vacancies] : null,
      start_date   ? ['Fecha estimada de inicio', start_date] : null,
      tiene_bono   ? ['¿Tiene bono?', `Sí${descripcion_bono ? ' — ' + descripcion_bono : ''}`] : null,
    ].filter(Boolean);

    const tableRows = rows.map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;white-space:nowrap;">${label}</td>
        <td style="padding:8px 12px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;">${value}</td>
      </tr>`).join('');

    const jdSection = jd_text ? `
      <div style="margin-top:24px;">
        <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Job Description</div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-size:13px;color:#374151;white-space:pre-wrap;line-height:1.6;">${jd_text}</div>
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
        from: 'HWG ATS <onboarding@resend.dev>',
        to: toAddresses,
        subject: `[HWG] Nuevo pedido — ${clientName || 'Cliente'}: ${title}`,
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
