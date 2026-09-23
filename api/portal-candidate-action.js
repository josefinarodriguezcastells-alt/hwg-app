// api/portal-candidate-action.js
// El cliente, desde su portal, puede Rechazar un candidato presentado o
// pedir que se agende una entrevista. Ambas acciones cambian datos reales
// (estado de la postulación) y mandan un mail al recruiter — por eso van
// por acá y no directo a Supabase con la clave anónima: la clave de Resend
// es secreta, y "applications"/"status_history" hoy tienen RLS totalmente
// abierto (anon_all: true, sin filtro — hallazgo pendiente de arreglar
// aparte), así que además de necesitar el mail, es más seguro resolver el
// cambio de estado acá con la clave de servicio.
//
// Nunca confía en client_id/position_id que mande el caller: resuelve el
// cliente a partir del portal_token, y valida que la postulación
// (application_id) pertenezca a una posición de ESE cliente antes de
// tocar nada — mismo criterio que portal-presentations.js.

const REJECTED_STATUS = 'rechazado';
const SCHEDULE_STATUS = 'entrevista_cliente_fit';
// Solo se puede Rechazar/Agendar mientras la postulación está esperando una
// decisión del cliente — mismo set que usa el portal para mostrar los
// botones (WAITING_ON_CLIENT_STATUSES en ClientPortal.jsx). Sin este check
// un request repetido o una carrera con un cambio de estado del recruiter
// podía pisar un estado más avanzado (ej. 'offer') con 'rechazado'
// (hallazgo de Greptile).
const ALLOWED_SOURCE_STATUSES = ['submitted', 'entrevista_cliente_fit', 'entrevista_cliente_tech', 'entrevista_cliente_cultura'];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COPY = {
  es: {
    reject: {
      subject: (candidateName, positionRole) => `Rechazado: ${candidateName} — ${positionRole}`,
      title: '❌ Candidato rechazado',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} rechazó a <strong>${candidateName}</strong> para la búsqueda de <strong>${positionRole}</strong>.`,
      reasonLabel: 'Motivo',
      cta: 'Ver postulación →',
    },
    schedule: {
      subject: (candidateName, positionRole) => `Agendar: ${candidateName} — ${positionRole}`,
      title: '📅 Pidieron agendar una entrevista',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} quiere agendar una entrevista con <strong>${candidateName}</strong> para la búsqueda de <strong>${positionRole}</strong>.`,
      reasonLabel: 'Disponibilidad indicada',
      cta: 'Coordinar →',
    },
    footer: 'HWG Talent Consultants · Notificación automática desde el portal de clientes',
  },
  en: {
    reject: {
      subject: (candidateName, positionRole) => `Rejected: ${candidateName} — ${positionRole}`,
      title: '❌ Candidate rejected',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} rejected <strong>${candidateName}</strong> for the <strong>${positionRole}</strong> search.`,
      reasonLabel: 'Reason',
      cta: 'View application →',
    },
    schedule: {
      subject: (candidateName, positionRole) => `Schedule: ${candidateName} — ${positionRole}`,
      title: '📅 Interview scheduling requested',
      body: (candidateName, positionRole, clientName) =>
        `${clientName} wants to schedule an interview with <strong>${candidateName}</strong> for the <strong>${positionRole}</strong> search.`,
      reasonLabel: 'Availability provided',
      cta: 'Coordinate →',
    },
    footer: 'HWG Talent Consultants · Automatic notification from the client portal',
  },
};

function buildEmailHtml(t, action, candidateName, positionRole, clientName, detailText, ctaUrl) {
  const c = t[action];
  const color = action === 'reject' ? '#dc2626' : '#7c3aed';
  // Todo lo que viene del cliente (detailText) o de datos guardados
  // (nombres) se escapa antes de ir al HTML del mail — un portal_token
  // activo alcanza para escribir el "motivo"/"disponibilidad", y ese mail
  // sale con la marca oficial de HWG a la bandeja del recruiter (hallazgo
  // de seguridad de Greptile).
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
    <div style="background:${color};padding:24px 32px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${c.title}</div>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;font-size:14px;color:#111827;line-height:1.6;">${c.body(candidateName, positionRole, clientName)}</p>
      ${detailText ? `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${c.reasonLabel}</div>
        <div style="font-size:14px;color:#111827;white-space:pre-wrap;">${detailText}</div>
      </div>` : ''}
      <div style="text-align:center;margin-bottom:8px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">${c.cta}</a>
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

  const { portal_token, application_id, action, text, lang } = req.body || {};
  if (!portal_token || !application_id || !['reject', 'schedule'].includes(action)) {
    return res.status(400).json({ error: 'Faltan datos (portal_token, application_id, action)' });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(application_id)) return res.status(400).json({ error: 'application_id inválido' });
  const detailText = typeof text === 'string' ? text.trim().slice(0, 2000) : '';

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables de entorno de Supabase no configuradas' });
  }
  const baseHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

  try {
    const clientResp = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?portal_token=eq.${encodeURIComponent(portal_token)}&portal_active=eq.true&select=id,name`,
      { headers: baseHeaders }
    );
    const clientRows = await clientResp.json();
    if (!clientResp.ok) return res.status(clientResp.status).json({ error: clientRows });
    const client = Array.isArray(clientRows) ? clientRows[0] : null;
    if (!client) return res.status(403).json({ error: 'Portal inválido' });

    // La postulación tiene que pertenecer a una posición de ESTE cliente —
    // se resuelve con un join, no se confía en el application_id solo.
    const appResp = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?id=eq.${application_id}&select=id,status,candidate_id,position_id,positions!inner(id,role,client_id)`,
      { headers: baseHeaders }
    );
    const appRows = await appResp.json();
    if (!appResp.ok) return res.status(appResp.status).json({ error: appRows });
    const app = Array.isArray(appRows) ? appRows[0] : null;
    if (!app || app.positions?.client_id !== client.id) {
      return res.status(403).json({ error: 'Postulación inválida' });
    }
    if (!ALLOWED_SOURCE_STATUSES.includes(app.status)) {
      return res.status(409).json({ error: 'Esta postulación ya no está en un estado que permita esta acción' });
    }

    const candResp = await fetch(
      `${SUPABASE_URL}/rest/v1/candidates?id=eq.${app.candidate_id}&select=name`,
      { headers: baseHeaders }
    );
    const candRows = await candResp.json();
    const candidateName = (Array.isArray(candRows) ? candRows[0]?.name : null) || 'Candidato';
    const positionRole = app.positions?.role || '';

    const oldStatus = app.status;
    const newStatus = action === 'reject' ? REJECTED_STATUS : SCHEDULE_STATUS;
    const now = new Date().toISOString();
    const updatePayload = { status: newStatus, last_updated: now, status_confirmed_at: now };
    if (action === 'reject') {
      updatePayload.rejection_quien = 'cliente';
      updatePayload.rejection_motivo = detailText || 'Sin motivo registrado';
    }
    // Update condicional (status=eq.oldStatus en el filtro): si otro
    // request, o el recruiter desde el ATS, ya movió esta postulación
    // mientras tanto, PostgREST no toca ninguna fila y updRows vuelve
    // vacío — evita pisar un estado más avanzado (ej. 'offer') con
    // 'rechazado'/'entrevista_cliente_fit' (carrera, hallazgo de Greptile).
    const updResp = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?id=eq.${application_id}&status=eq.${encodeURIComponent(oldStatus)}`,
      { method: 'PATCH', headers: { ...baseHeaders, Prefer: 'return=representation' }, body: JSON.stringify(updatePayload) }
    );
    if (!updResp.ok) {
      const errBody = await updResp.json().catch(() => ({}));
      return res.status(updResp.status).json({ error: errBody });
    }
    const updRows = await updResp.json();
    if (!Array.isArray(updRows) || updRows.length === 0) {
      return res.status(409).json({ error: 'La postulación cambió de estado mientras tanto — recargá el portal e intentá de nuevo' });
    }

    // changed_by queda null (no hay usuario interno acá) — status_history
    // ya muestra "—" para ese caso en el ATS; el motivo/rejection_quien
    // ('cliente') es lo que realmente distingue este cambio en las vistas
    // que ya existen (CandidatesPage, PositionDetail).
    // 'entrevista_cliente_fit' es a la vez estado de origen permitido y
    // destino de 'schedule' — pedir Agendar de nuevo mientras ya se está en
    // ese estado es un no-op de estado real, así que no insertamos una
    // entrada de historial "sin transición" (hallazgo de Greptile); la nota
    // con la nueva disponibilidad y el mail al recruiter sí se mandan, son
    // información nueva aunque el estado no haya cambiado.
    let histResp = { ok: true };
    if (oldStatus !== newStatus) {
      histResp = await fetch(
        `${SUPABASE_URL}/rest/v1/status_history`,
        { method: 'POST', headers: { ...baseHeaders, Prefer: 'return=minimal' }, body: JSON.stringify([{ application_id, old_status: oldStatus, new_status: newStatus, changed_by: null }]) }
      );
      if (!histResp.ok) {
        const errBody = await histResp.json().catch(() => ({}));
        console.error('portal-candidate-action: status_history insert failed', errBody);
      }
    }

    const noteVerdict = action === 'reject' ? 'rechazo' : 'agenda_solicitada';
    const noteResp = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_notes`,
      { method: 'POST', headers: { ...baseHeaders, Prefer: 'return=minimal' }, body: JSON.stringify([{ client_id: client.id, candidate_id: app.candidate_id, application_id, note: `[${noteVerdict}] ${detailText}`.trim() }]) }
    );
    if (!noteResp.ok) {
      const errBody = await noteResp.json().catch(() => ({}));
      console.error('portal-candidate-action: client_portal_notes insert failed', errBody);
    }

    // Si el estado cambió pero el rastro (status_history/client_portal_notes)
    // no se pudo guardar, no devolvemos ok:true sobre una escritura a medio
    // hacer (hallazgo de Greptile) — revertimos el estado y avisamos error
    // real, para que el cliente reintente en vez de creer que ya quedó.
    if (!histResp.ok || !noteResp.ok) {
      const rollbackPayload = { status: oldStatus, last_updated: now };
      if (action === 'reject') { rollbackPayload.rejection_quien = null; rollbackPayload.rejection_motivo = null; }
      // Condicional a newStatus, igual que el update original: si otro
      // request (o el recruiter) ya movió la postulación de nuevo desde que
      // la pusimos en newStatus, este rollback no debe pisar esa transición
      // más nueva con el oldStatus viejo (hallazgo de Greptile).
      const rollbackResp = await fetch(
        `${SUPABASE_URL}/rest/v1/applications?id=eq.${application_id}&status=eq.${encodeURIComponent(newStatus)}`,
        { method: 'PATCH', headers: { ...baseHeaders, Prefer: 'return=representation' }, body: JSON.stringify(rollbackPayload) }
      ).catch(e => { console.error('portal-candidate-action: rollback failed', e); return null; });
      if (rollbackResp) {
        const rollbackRows = await rollbackResp.json().catch(() => null);
        if (!rollbackResp.ok || !Array.isArray(rollbackRows) || rollbackRows.length === 0) {
          console.error('portal-candidate-action: rollback did not apply (status moved on since)', { ok: rollbackResp.ok, rollbackRows });
        }
      }
      return res.status(500).json({ error: 'No se pudo completar la acción, intentá de nuevo' });
    }

    // El mail al recruiter es best-effort: si Resend no está configurado o
    // falla, la acción del cliente (que ya tocó datos reales) no se revierte
    // — el recruiter igual ve el cambio en el ATS y la alerta in-app.
    if (RESEND_API_KEY) {
      try {
        const recResp = await fetch(
          `${SUPABASE_URL}/rest/v1/position_recruiters?position_id=eq.${app.position_id}&select=recruiter_id`,
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
        if (toAddresses.length) {
          const t = COPY[lang === 'en' ? 'en' : 'es'];
          const c = t[action];
          const ctaUrl = `https://hwgats.vercel.app/portal/${portal_token}`;
          const html = buildEmailHtml(t, action, candidateName, positionRole, client.name || '', detailText, ctaUrl);
          const emailResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'HWG Talent Consultants <notificaciones@hwgtalent.com>',
              to: toAddresses,
              cc: 'josie@hwgtalent.com',
              subject: c.subject(candidateName, positionRole),
              html,
            }),
          });
          if (!emailResp.ok) {
            const emailErr = await emailResp.json().catch(() => ({}));
            console.error('portal-candidate-action: Resend error', emailErr);
          }
        }
      } catch (mailErr) {
        console.error('portal-candidate-action: email failed', mailErr);
      }
    }

    return res.status(200).json({ ok: true, status: newStatus });
  } catch (e) {
    console.error('portal-candidate-action error:', e);
    return res.status(500).json({ error: e.message });
  }
};
