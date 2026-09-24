// api/notify-new-candidate.js
// El recruiter, al publicar un informe (que ya deja al candidato en
// 'submitted'), puede elegir avisarle al cliente por mail. Va al/a los
// mail(es) de contacto del cliente (clients.stakeholder[].email), con
// copia fija a josie@hwgtalent.com y reply-to al mail real del recruiter
// a cargo — así si el hiring manager responde, le llega a quien está
// llevando la búsqueda, no a una casilla sin dueño. `lang` lo elige el
// recruiter a mano en el momento de mandar (no se infiere) porque hay
// clientes en inglés y no hay ningún campo de idioma guardado por cliente.
//
// Opcionalmente adjunta el informe en PDF (pdfBase64): lo arma el ATS en el
// navegador con los mismos datos del link publicado, así el cliente lo
// tiene a mano sin depender del link. No se guarda en ningún lado — viaja
// en este pedido y se adjunta al mail.

import { requireRole } from './_auth.js';

// Tope del adjunto (ya decodificado). Un informe real pesa ~75 KB; esto
// deja margen de sobra y queda lejos del límite de 4,5 MB por pedido de
// Vercel (el base64 pesa ~33% más).
const MAX_PDF_BYTES = 2 * 1024 * 1024;

const COPY = {
  es: {
    preheader: (pos, client) => `${pos} — ${client}`,
    title: '👤 Nuevo candidato presentado',
    greeting: (name) => `Hola ${name || ''},`.trim(),
    body: (candidateName, positionRole) =>
      `Tenemos un nuevo candidato para tu revisión: <strong>${candidateName}</strong>, para la búsqueda de <strong>${positionRole}</strong>.`,
    salaryLabel: 'Salario pretendido',
    cta: 'Ver informe completo →',
    portalCta: 'Portal',
    attachmentNote: 'Te adjuntamos también el informe en PDF.',
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
    portalCta: 'Portal',
    attachmentNote: "We've also attached the report as a PDF.",
    closing: "We're looking forward to your feedback.",
    signoff: 'Best,<br/>HWG Team',
    footer: 'HWG Talent Consultants · Automatic notification from the client portal',
    subject: (positionRole, candidateName) => `${positionRole} - ${candidateName} - HWG Talent Consultants`,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
      pdfBase64,          // opcional — informe en PDF, base64 sin prefijo data:
      pdfFilename,        // opcional — nombre del adjunto
    } = req.body;

    // informeUrl pasa a ser obligatorio, no opcional — Jo lo vio en un mail
    // real (candidato Nicolás Mogliani): con informeUrl vacío, el botón
    // "Ver informe completo" caía en silencio a portalUrl, así que el
    // cliente veía un botón con esa etiqueta que en realidad lo mandaba al
    // portal. Mejor rechazar el envío acá con un error claro (el frontend
    // ya lo muestra en el modal) que mandar un mail con un botón que dice
    // una cosa y hace otra.
    if (!Array.isArray(to) || to.length === 0 || !candidateName || !positionRole || !informeUrl || !portalUrl || !recruiterEmail) {
      return res.status(400).json({ error: 'Faltan datos (to, candidateName, positionRole, informeUrl, portalUrl, recruiterEmail)' });
    }

    // El PDF es opcional, pero si viene tiene que ser un PDF de verdad y de
    // tamaño razonable: se rechaza el envío entero en vez de mandar el mail
    // sin el adjunto en silencio (el recruiter vería "enviado" y el cliente
    // no tendría el PDF que se le prometió en el cuerpo del mail).
    let attachments;
    if (pdfBase64 != null) {
      // Mandar un archivo arbitrario desde la dirección de HWG solo con
      // sesión del ATS (owner o recruiter) — si no, cualquiera que conozca
      // esta URL podría distribuir un "informe" falso a nombre de HWG.
      // El mail sin adjunto todavía no exige sesión porque el ATS que está
      // en producción hoy no la manda; cerrarlo también es el paso
      // siguiente, una vez deployado el ATS que manda el token.
      const session = requireRole(req, res, ['owner', 'recruiter']);
      if (!session) return;
      const buf = typeof pdfBase64 === 'string' ? Buffer.from(pdfBase64, 'base64') : null;
      // Empieza con %PDF- y termina con %%EOF (en el último KB, puede venir
      // seguido de un salto de línea): descarta archivos cortados a medias
      // que el cliente no podría abrir.
      if (!buf || buf.length === 0 || buf.subarray(0, 5).toString('latin1') !== '%PDF-'
          || !buf.subarray(-1024).toString('latin1').includes('%%EOF')) {
        return res.status(400).json({ error: 'El adjunto no es un PDF válido' });
      }
      if (buf.length > MAX_PDF_BYTES) {
        return res.status(400).json({ error: 'El PDF adjunto es demasiado grande (máx. 2 MB)' });
      }
      // Nombre de archivo seguro: sin rutas ni caracteres raros, siempre .pdf.
      const base = String(pdfFilename || candidateName || 'informe')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'informe';
      attachments = [{ filename: `${base}.pdf`, content: buf.toString('base64') }];
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
      ${attachments ? `<p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;">📎 ${t.attachmentNote}</p>` : ''}

      <div style="text-align:center;margin-bottom:10px;">
        <a href="${informeUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          ${t.cta}
        </a>
      </div>
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${portalUrl}" style="color:#7c3aed;font-size:12px;text-decoration:none;">${t.portalCta}</a>
      </div>

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
        ...(attachments ? { attachments } : {}),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data.message || 'Error al enviar mail' });
    }

    // attached: el ATS lo usa para confirmarle al recruiter si el PDF salió.
    return res.status(200).json({ ok: true, id: data.id, attached: !!attachments });

  } catch (err) {
    console.error('notify-new-candidate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
