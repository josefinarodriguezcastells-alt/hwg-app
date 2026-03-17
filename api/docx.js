const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType
} = require('docx');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, lang } = req.body;
    const isEs = lang === 'es';
    const today = new Date().toLocaleDateString(isEs ? 'es-AR' : 'en-US', {day:'2-digit', month:'long', year:'numeric'});

    // ── Colors ────────────────────────────────────────────────────────────────
    const VIOLET       = '7C3AED';
    const VIOLET_LIGHT = 'EDE9FE';
    const LIME         = '65A30D';
    const LIME_LIGHT   = 'F0FDF4';
    const AMBER        = 'D97706';
    const AMBER_LIGHT  = 'FFFBEB';
    const BLACK        = '111827';
    const GRAY         = '6B7280';
    const BORDER       = 'E5E7EB';
    const WHITE        = 'FFFFFF';

    // ── Labels ────────────────────────────────────────────────────────────────
    const L = isEs ? {
      contact:      'INFORMACIÓN DE CONTACTO',
      evaluation:   'EVALUACIÓN',
      techFit:      'Fit técnico',
      experience:   'Experiencia',
      cultureFit:   'Culture fit',
      english:      'Nivel de inglés',
      trajectory:   'TRAYECTORIA PROFESIONAL',
      tools:        'STACK TÉCNICO Y HERRAMIENTAS',
      whyFit:       'POR QUÉ ES FIT PARA ESTE ROL',
      gap:          'GAP ANALYSIS',
      linkedin:     'LinkedIn',
      phone:        'Teléfono',
      email:        'Email',
      salary:       'Salario pretendido',
      availability: 'Disponibilidad',
      presentedBy:  'Presentado por',
      presentedFor: 'Presentado para',
    } : {
      contact:      'CONTACT INFORMATION',
      evaluation:   'EVALUATION',
      techFit:      'Technical fit',
      experience:   'Experience',
      cultureFit:   'Culture fit',
      english:      'English level',
      trajectory:   'PROFESSIONAL BACKGROUND',
      tools:        'TECH STACK & TOOLS',
      whyFit:       'WHY THIS CANDIDATE FITS',
      gap:          'GAP ANALYSIS',
      linkedin:     'LinkedIn',
      phone:        'Phone',
      email:        'Email',
      salary:       'Salary expectation',
      availability: 'Availability',
      presentedBy:  'Presented by',
      presentedFor: 'Presented for',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const noBorder    = { style: BorderStyle.NONE, size: 0, color: WHITE };
    const thinBorder  = { style: BorderStyle.SINGLE, size: 2, color: BORDER };
    const allNoBorder = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    const sp = (before=0, after=0) => ({ before, after });

    const txt = (text, opts={}) => new TextRun({
      text: String(text || ''),
      font: 'Arial',
      size: opts.size || 22,
      bold: opts.bold || false,
      italics: opts.italic || false,
      color: opts.color || BLACK,
      characterSpacing: opts.characterSpacing,
    });

    const para = (children, opts={}) => new Paragraph({
      spacing: opts.spacing || sp(0, 0),
      alignment: opts.align || AlignmentType.LEFT,
      indent: opts.indent,
      border: opts.border,
      shading: opts.shading,
      children: Array.isArray(children) ? children : [children],
    });

    const sectionHead = (label) => new Paragraph({
      spacing: sp(400, 140),
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: VIOLET } },
      indent: { left: 120 },
      children: [txt(label, { size: 18, bold: true, color: VIOLET, characterSpacing: 80 })]
    });

    const infoLine = (label, value, valueColor) => new Paragraph({
      spacing: sp(0, 0),
      border: { bottom: thinBorder },
      children: [
        txt(`${label}   `, { size: 20, color: GRAY }),
        txt(String(value || '[COMPLETAR]'), { size: 20, bold: true, color: valueColor || BLACK }),
      ]
    });

    // ── HEADER ────────────────────────────────────────────────────────────────
    const rec = data.recommendation || '';
    const recColor = rec.toLowerCase().includes('no recom') ? 'DC2626'
                   : rec.toLowerCase().includes('cautela') ? AMBER
                   : VIOLET;

    const headerSection = [
      para(txt(data.name || '[COMPLETAR]', { size: 52, bold: true, color: BLACK }), { spacing: sp(0, 60) }),
      para([
        txt(data.role || '', { size: 22, color: GRAY }),
        txt('  ·  ', { size: 22, color: BORDER }),
        txt(data.location || '', { size: 22, color: GRAY }),
        txt('  ·  ', { size: 22, color: BORDER }),
        txt(data.modality || '', { size: 22, color: GRAY }),
      ], { spacing: sp(0, 80) }),
      ...(rec ? [para(txt(`▶  ${rec}`, { size: 20, bold: true, color: recColor }), { spacing: sp(60, 0) })] : []),
      new Paragraph({
        spacing: sp(180, 200),
        border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: VIOLET } },
        children: []
      }),
      para([
        txt(`${L.presentedFor}:  `, { size: 20, color: GRAY }),
        txt(data.personal?.position || '', { size: 20, bold: true, color: BLACK }),
        txt('   ·   ', { size: 20, color: BORDER }),
        txt(today, { size: 20, color: GRAY }),
      ], { spacing: sp(0, 320) }),
    ];

    // ── CONTACT ───────────────────────────────────────────────────────────────
    const contactSection = [
      sectionHead(L.contact),
      infoLine(L.linkedin,     data.personal?.linkedin     || '[COMPLETAR]', VIOLET),
      infoLine(L.phone,        data.personal?.phone        || '[COMPLETAR]'),
      infoLine(L.email,        data.personal?.email        || '[COMPLETAR]'),
      infoLine(L.salary,       data.personal?.salary       || data.snapshot?.salary || '[COMPLETAR]'),
      infoLine(L.availability, data.personal?.availability || data.snapshot?.avail  || '[COMPLETAR]', LIME),
      para([], { spacing: sp(0, 80) }),
    ];

    // ── EVALUATION ────────────────────────────────────────────────────────────
    const evalSection = [
      sectionHead(L.evaluation),
      infoLine(L.techFit,    `${data.snapshot?.techFit || '?'} / 10`, VIOLET),
      infoLine(L.experience, data.snapshot?.exp  || '[COMPLETAR]'),
      infoLine(L.cultureFit, data.snapshot?.cult || '[COMPLETAR]'),
      infoLine(L.english,    data.snapshot?.englishLevel || '[COMPLETAR]'),
      para([], { spacing: sp(0, 80) }),
    ];

    // ── TRAJECTORY ────────────────────────────────────────────────────────────
    const expItems = Array.isArray(data.experience) ? data.experience : [];
    const trajectorySection = [
      sectionHead(L.trajectory),
      ...expItems.flatMap((e, i) => [
        new Paragraph({
          spacing: sp(i === 0 ? 0 : 180, 40),
          children: [
            txt('● ', { size: 20, color: VIOLET }),
            txt(e.role || '', { size: 22, bold: true, color: BLACK }),
          ]
        }),
        para([
          txt(e.company || '', { size: 20, bold: true, color: GRAY }),
          txt(e.period ? `   ·   ${e.period}` : '', { size: 19, color: GRAY, italic: true }),
        ], { spacing: sp(0, 0), indent: { left: 240 } }),
      ]),
      para([], { spacing: sp(0, 80) }),
    ];

    // ── TOOLS — pills layout 3 per row ────────────────────────────────────────
    const tools = data.tools || [];
    const toolsSection = tools.length === 0 ? [] : [
      sectionHead(L.tools),
      ...chunkArray(tools, 3).map(rowTools => {
        const cellWidth = Math.floor(9360 / 3);
        const cells = rowTools.map(tool => new TableCell({
          width: { size: cellWidth, type: WidthType.DXA },
          borders: allNoBorder,
          margins: { top: 80, bottom: 80, left: 80, right: 80 },
          shading: { fill: VIOLET_LIGHT, type: ShadingType.CLEAR },
          children: [new Paragraph({
            spacing: sp(0, 0),
            children: [
              txt(tool.tool || '', { size: 20, bold: true, color: VIOLET }),
              ...(tool.years ? [txt(`  ${tool.years}y`, { size: 18, color: GRAY })] : []),
              ...(tool.level ? [txt(`  ·  ${tool.level}`, { size: 18, color: GRAY })] : []),
            ]
          })]
        }));
        // Pad to 3 cells
        while (cells.length < 3) {
          cells.push(new TableCell({
            width: { size: cellWidth, type: WidthType.DXA },
            borders: allNoBorder,
            margins: { top: 80, bottom: 80, left: 80, right: 80 },
            children: [para(txt(''), {})]
          }));
        }
        return new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [cellWidth, cellWidth, cellWidth],
          rows: [new TableRow({ children: cells })]
        });
      }),
      para([], { spacing: sp(0, 80) }),
    ];

    // ── WHY FIT ───────────────────────────────────────────────────────────────
    const whySection = [
      sectionHead(L.whyFit),
      new Paragraph({
        spacing: sp(60, 240),
        border: { left: { style: BorderStyle.SINGLE, size: 20, color: LIME } },
        shading: { fill: LIME_LIGHT, type: ShadingType.CLEAR },
        indent: { left: 140 },
        children: [txt(data.storytelling || data.why || '', { size: 22, italic: true, color: '374151' })]
      }),
    ];

    // ── GAP ANALYSIS ─────────────────────────────────────────────────────────
    const gapItems = Array.isArray(data.gap) ? data.gap
      : (typeof data.gap === 'string' && data.gap ? [{ title: 'Gap', detail: data.gap }] : []);

    const gapSection = gapItems.length > 0 ? [
      sectionHead(L.gap),
      ...gapItems.map((g, i) => new Paragraph({
        spacing: sp(i === 0 ? 60 : 120, 60),
        border: { left: { style: BorderStyle.SINGLE, size: 20, color: AMBER } },
        shading: { fill: AMBER_LIGHT, type: ShadingType.CLEAR },
        indent: { left: 140 },
        children: [
          txt(`${g.title}:  `, { size: 22, bold: true, color: AMBER }),
          txt(g.detail || '', { size: 22, color: '374151' }),
        ]
      })),
      para([], { spacing: sp(0, 160) }),
    ] : [];

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const footer = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: sp(200, 0),
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER } },
      children: [
        txt(`${L.presentedBy}  `, { size: 18, color: GRAY }),
        txt('HWG Talent Consultants', { size: 18, bold: true, color: BLACK }),
        txt('   ·   ', { size: 18, color: BORDER }),
        txt(today, { size: 18, color: GRAY }),
        txt('   ·   ', { size: 18, color: BORDER }),
        txt('www.hwgtalent.com', { size: 18, bold: true, color: VIOLET }),
      ]
    });

    // ── ASSEMBLE ──────────────────────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children: [
          ...headerSection,
          ...contactSection,
          ...evalSection,
          ...trajectorySection,
          ...toolsSection,
          ...whySection,
          ...gapSection,
          footer,
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    // ── Email ─────────────────────────────────────────────────────────────────
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      const recruiterInfo = data.personal?.position ? ` — ${data.personal.position}` : '';
      await transporter.sendMail({
        from: `"HWG Form Generator" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `📋 Nuevo form: ${data.name}${recruiterInfo}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">
            <div style="background:#111827;padding:16px 24px;border-radius:8px 8px 0 0;">
              <span style="color:#7c3aed;font-weight:700;font-size:18px;">HWG</span>
              <span style="color:#fff;font-weight:700;font-size:18px;"> Talent Consultants</span>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin-bottom:16px;">Se generó un nuevo form de presentación:</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px 0;font-weight:700;width:160px;">Candidato</td><td>${data.name}</td></tr>
                <tr><td style="padding:8px 0;font-weight:700;">Rol</td><td>${data.role}</td></tr>
                ${data.personal?.position ? `<tr><td style="padding:8px 0;font-weight:700;">Posición</td><td>${data.personal.position}</td></tr>` : ''}
                ${data.recommendation ? `<tr><td style="padding:8px 0;font-weight:700;">Recomendación</td><td>${data.recommendation}</td></tr>` : ''}
                <tr><td style="padding:8px 0;font-weight:700;">Fecha</td><td>${today}</td></tr>
              </table>
              <p style="margin-top:20px;font-size:13px;color:#888;">El documento Word está adjunto.</p>
            </div>
          </div>`,
        attachments: [{
          filename: `${(data.name || 'candidato').replace(/\s+/g, '_')}_HWG.docx`,
          content: buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }]
      });
    } catch(mailErr) {
      console.error('Mail error:', mailErr.message);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=${(data.name || 'candidato').replace(/\s+/g, '_')}_HWG.docx`);
    res.status(200).send(buffer);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}
