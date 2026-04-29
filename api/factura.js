// api/factura.js
// Recibe los datos de la factura como JSON en query param ?data=...
// y devuelve un HTML/PDF con diseño HWG — sin dependencias externas

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let factura;
  try {
    const raw = req.query.data;
    if (!raw) return res.status(400).send('Falta el parámetro data');
    factura = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch(e) {
    return res.status(400).send('Datos inválidos');
  }

  const {
    numero = '—', tipo = 'embedded', mes = '', cliente = '',
    entidad_nombre = '', entidad_direccion = '', entidad_cuit = '',
    moneda = 'USD', total = 0, nota = '',
    items = [],
    // Bancarios ARS
    banco = '', cbu = '', alias = '',
    // Bancarios USD
    bank_name = '', beneficiary = '', swift = '', aba = '', account_number = '',
    entidad_moneda = 'USD',
  } = factura;

  const mesLabel = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T12:00:00');
      return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    } catch(e) { return iso; }
  };

  const fechaEmision = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  const itemRows = (Array.isArray(items) ? items : []).map(item => `
    <tr>
      <td style="padding:10px 0;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;vertical-align:top;">
        <div style="font-weight:500;">${item.texto || ''}</div>
        ${item.detalle ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${item.detalle}</div>` : ''}
      </td>
      <td style="padding:10px 0;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:500;white-space:nowrap;vertical-align:top;">
        ${item.moneda || moneda} ${parseFloat(item.monto || 0).toLocaleString('es-AR')}
      </td>
    </tr>`).join('');

  const bancarios = entidad_moneda === 'ARS'
    ? [banco && `Banco: ${banco}`, entidad_cuit && `CUIT: ${entidad_cuit}`, cbu && `CBU/CVU: ${cbu}`, alias && `Alias: ${alias}`].filter(Boolean)
    : [bank_name && `Banco: ${bank_name}`, beneficiary && `Beneficiario: ${beneficiary}`, swift && `SWIFT/BIC: ${swift}`, aba && `ABA/Routing: ${aba}`, account_number && `Account: ${account_number}`].filter(Boolean);

  const bancarioRows = bancarios.map(b => `<tr><td colspan="2" style="padding:5px 0;font-size:12px;color:#4b5563;">${b}</td></tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Factura ${numero} — HWG Talent</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111827}
    .page{max-width:680px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,0.08)}
    .header{background:#7c3aed;padding:32px 40px}
    .brand{color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.02em}
    .brand-sub{color:#ede9fe;font-size:12px;margin-top:3px;letter-spacing:0.05em;text-transform:uppercase}
    .badge{background:rgba(255,255,255,0.15);color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase}
    .header-top{display:flex;justify-content:space-between;align-items:flex-start}
    .header-bottom{margin-top:20px;display:flex;justify-content:space-between;align-items:flex-end}
    .factura-num{color:#fff;font-size:28px;font-weight:700}
    .meta{text-align:right}
    .meta div{color:#ede9fe;font-size:12px;margin-top:4px}
    .body{padding:32px 40px}
    .section{margin-bottom:28px}
    .section-title{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #f3f4f6}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
    .field-label{font-size:11px;color:#9ca3af;margin-bottom:3px}
    .field-value{font-size:13px;color:#111827;font-weight:500}
    .items-table{width:100%;border-collapse:collapse}
    .total-row{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:2px solid #7c3aed}
    .total-label{font-size:14px;color:#374151;font-weight:600}
    .total-amount{font-size:26px;font-weight:700;color:#7c3aed}
    .bancarios-section{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px}
    .footer{padding:16px 40px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
    .topbar{background:#7c3aed;padding:12px 40px;display:flex;justify-content:space-between;align-items:center}
    @media print{.topbar{display:none!important}.page{box-shadow:none;margin:0;border-radius:0}}
  </style>
</head>
<body>
  <div class="topbar">
    <span style="color:#ede9fe;font-size:13px;">Factura ${numero} — ${cliente}</span>
    <button onclick="window.print()" style="background:#fff;color:#7c3aed;border:none;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">⬇ Descargar PDF</button>
  </div>
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div>
          <div class="brand">HWG Talent</div>
          <div class="brand-sub">Talent Consultants</div>
        </div>
        <div class="badge">${tipo === 'embedded' ? 'Embedded' : 'Contingency'}</div>
      </div>
      <div class="header-bottom">
        <div class="factura-num">N° ${numero}</div>
        <div class="meta">
          <div>Fecha de emisión: ${fechaEmision}</div>
          ${mes ? `<div>Período: ${mesLabel(mes)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="body">
      <div class="section">
        <div class="section-title">Datos de facturación</div>
        <div class="grid2">
          <div>
            <div class="field-label">Facturado por</div>
            <div class="field-value">${entidad_nombre || '—'}</div>
            ${entidad_direccion ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;">${entidad_direccion}</div>` : ''}
            ${entidad_cuit && entidad_moneda === 'ARS' ? `<div style="font-size:12px;color:#6b7280;">CUIT: ${entidad_cuit}</div>` : ''}
          </div>
          <div>
            <div class="field-label">Cliente</div>
            <div class="field-value">${cliente || '—'}</div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Detalle</div>
        <table class="items-table"><tbody>${itemRows}</tbody></table>
        <div class="total-row">
          <span class="total-label">Total</span>
          <span class="total-amount">${moneda} ${parseFloat(total).toLocaleString('es-AR')}</span>
        </div>
        ${nota ? `<div style="margin-top:16px;padding:12px 16px;background:#faf5ff;border-radius:6px;font-size:12px;color:#5b21b6;">${nota}</div>` : ''}
      </div>
      ${bancarios.length > 0 ? `
      <div class="section">
        <div class="section-title">Datos bancarios para transferencia</div>
        <div class="bancarios-section">
          <table style="width:100%;border-collapse:collapse;">${bancarioRows}</table>
        </div>
      </div>` : ''}
    </div>
    <div class="footer">
      <span>HWG Talent Consultants · hwgtalent.com</span>
      <span>Generada desde HWG ATS</span>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
};
