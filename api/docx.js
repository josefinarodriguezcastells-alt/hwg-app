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
    const VIOLET     = '7C3AED';
    const LIME       = '65A30D';    const LIME_LIGHT = 'F0FDF4';
    const AMBER      = 'D97706';
    const AMBER_LIGHT = 'FFFBEB';
    const BLACK      = '111827';
    const GRAY       = '6B7280';
    const LIGHT_GRAY = 'F9FAFB';
    const BORDER     = 'E5E7EB';
    const WHITE      = 'FFFFFF';

    // ── Labels ────────────────────────────────────────────────────────────────
    const L = isEs ? {
      contact:      'CONTACTO',
      evaluation:   'EVALUACIÓN',
      techFit:      'Fit técnico',
      experience:   'Experiencia',
      cultureFit:   'Culture fit',
      english:      'Nivel de inglés',
      trajectory:   'TRAYECTORIA',
      tools:        'HERRAMIENTAS Y SISTEMAS',
      toolCol:      'Herramienta',
      yearsCol:     'Años',
      levelCol:     'Nivel',
      whyFit:       'POR QUÉ ES FIT PARA ESTE ROL',
      gap:          'GAP ANALYSIS',
      linkedin:     'LinkedIn',
      phone:        'Teléfono',
      email:        'Email',
      salary:       'Salario pretendido',
      availability: 'Disponibilidad',
      position:     'Posición',
      date:         'Fecha de presentación',
      presentedBy:  'Presentado por',
      presentedFor: 'Presentado para',
    } : {
      contact:      'CONTACT',
      evaluation:   'EVALUATION',
      techFit:      'Technical fit',
      experience:   'Experience',
      cultureFit:   'Culture fit',
      english:      'English level',
      trajectory:   'CAREER HISTORY',
      tools:        'TOOLS & STACK',
      toolCol:      'Tool',
      yearsCol:     'Years',
      levelCol:     'Level',
      whyFit:       'WHY THIS CANDIDATE FITS',
      gap:          'GAP ANALYSIS',
      linkedin:     'LinkedIn',
      phone:        'Phone',
      email:        'Email',
      salary:       'Salary expectation',
      availability: 'Availability',
      position:     'Position',
      date:         'Presentation date',
      presentedBy:  'Presented by',
      presentedFor: 'Presented for',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE };
    const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: BORDER };
    const violetBorder = { style: BorderStyle.SINGLE, size: 16, color: VIOLET };

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

    // Section heading with violet left bar
    const sectionHead = (label) => new Paragraph({
      spacing: sp(360, 120),
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: VIOLET } },
      indent: { left: 120 },
      children: [txt(label, { size: 18, bold: true, color: VIOLET, characterSpacing: 80 })]
    });

    // ── Two-column layout helper via Table ────────────────────────────────────
    const twoColTable = (leftChildren, rightChildren) => new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4560, 4800],
      rows: [new TableRow({ children: [
        new TableCell({
          width: { size: 4560, type: WidthType.DXA },
          borders: allNoBorder,
          margins: { top: 0, bottom: 0, left: 0, right: 160 },
          children: leftChildren,
        }),
        new TableCell({
          width: { size: 4800, type: WidthType.DXA },
          borders: allNoBorder,
          margins: { top: 0, bottom: 0, left: 160, right: 0 },
          children: rightChildren,
        }),
      ]})]
    });

    // Info row (label: value) for contact card
    const infoRow = (label, value, valueColor) => new TableRow({ children: [
      new TableCell({
        width: { size: 1800, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 100, bottom: 100, left: 120, right: 80 },
        children: [para(txt(label, { size: 20, color: GRAY }))]
      }),
      new TableCell({
        width: { size: 2600, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 100, bottom: 100, left: 80, right: 120 },
        children: [para(txt(value || '[COMPLETAR]', { size: 20, bold: true, color: valueColor || BLACK }))]
      }),
    ]});

    // Snapshot row (label + value) for evaluation card
    const snapRow = (label, value, valueColor) => new TableRow({ children: [
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 110, bottom: 110, left: 120, right: 80 },
        children: [para(txt(label, { size: 20, color: GRAY }))]
      }),
      new TableCell({
        width: { size: 2000, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 110, bottom: 110, left: 80, right: 120 },
        children: [para(txt(value || '[COMPLETAR]', { size: 20, bold: true, color: valueColor || BLACK }))]
      }),
    ]});

    // Card wrapper (shaded box with label)
    const cardLabel = (text) => para(txt(text, { size: 16, bold: true, color: GRAY, characterSpacing: 80 }), { spacing: sp(0, 80) });

    // ── HEADER ────────────────────────────────────────────────────────────────
    const rec = data.recommendation || '';
    const recColor = rec.toLowerCase().includes('no recom') ? 'DC2626'
                   : rec.toLowerCase().includes('cautela') ? AMBER
                   : VIOLET;

    const headerSection = [
      // Name
      para(txt(data.name || '[COMPLETAR]', { size: 52, bold: true, color: BLACK }), { spacing: sp(0, 60) }),
      // Role · Location · Modality
      para([
        txt(data.role || '', { size: 22, color: GRAY }),
        txt('  ·  ', { size: 22, color: BORDER }),
        txt(data.location || '', { size: 22, color: GRAY }),
        txt('  ·  ', { size: 22, color: BORDER }),
        txt(data.modality || '', { size: 22, color: GRAY }),
      ], { spacing: sp(0, 80) }),
      // Recommendation badge
      ...(rec ? [para(txt(`▶  ${rec}`, { size: 20, bold: true, color: recColor }), { spacing: sp(80, 0) })] : []),
      // Violet divider
      new Paragraph({
        spacing: sp(200, 200),
        border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: VIOLET } },
        children: []
      }),
      // Presented for line
      para([
        txt(`${L.presentedFor}:  `, { size: 20, color: GRAY }),
        txt(data.personal?.position || '', { size: 20, bold: true, color: BLACK }),
        txt('   ·   ', { size: 20, color: BORDER }),
        txt(today, { size: 20, color: GRAY }),
      ], { spacing: sp(0, 280) }),
    ];

    // ── CONTACT CARD ──────────────────────────────────────────────────────────
    const contactRows = [
      infoRow(L.linkedin,     data.personal?.linkedin     || '[COMPLETAR]', VIOLET),
      infoRow(L.phone,        data.personal?.phone        || '[COMPLETAR]'),
      infoRow(L.email,        data.personal?.email        || '[COMPLETAR]'),
      infoRow(L.salary,       data.personal?.salary       || data.snapshot?.salary || '[COMPLETAR]'),
      infoRow(L.availability, data.personal?.availability || data.snapshot?.avail  || '[COMPLETAR]', LIME),
    ];

    const contactCard = [
      cardLabel(L.contact),
      new Table({
        width: { size: 4400, type: WidthType.DXA },
        columnWidths: [1800, 2600],
        rows: contactRows,
      }),
    ];

    // ── EVALUATION CARD ───────────────────────────────────────────────────────
    const snapRows = [
      snapRow(L.techFit,    `${data.snapshot?.techFit || '?'} / 10`, VIOLET),
      snapRow(L.experience, data.snapshot?.exp || '[COMPLETAR]'),
      snapRow(L.cultureFit, data.snapshot?.cult || '[COMPLETAR]'),
      snapRow(L.english,    data.snapshot?.englishLevel || '[COMPLETAR]'),
    ];

    const evalCard = [
      cardLabel(L.evaluation),
      new Table({
        width: { size: 4640, type: WidthType.DXA },
        columnWidths: [2400, 2240],
        rows: snapRows,
      }),
    ];

    // ── TRAJECTORY ────────────────────────────────────────────────────────────
    const expItems = Array.isArray(data.experience) ? data.experience : [];
    const trajectoryRows = expItems.flatMap((e, i) => [
      new Paragraph({
        spacing: sp(i === 0 ? 0 : 160, 40),
        children: [
          txt('● ', { size: 20, color: VIOLET }),
          txt(e.role || '', { size: 22, bold: true, color: BLACK }),
        ]
      }),
      para(txt(e.company || '', { size: 20, color: GRAY }), { spacing: sp(0, 0) }),
      para(txt(e.period || '', { size: 18, color: GRAY, italic: true }), { spacing: sp(0, 40) }),
    ]);

    // ── TOOLS TABLE ───────────────────────────────────────────────────────────
    const toolsHeader = new TableRow({ children: [
      new TableCell({
        width: { size: 5400, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: violetBorder },
        margins: { top: 80, bottom: 80, left: 120, right: 80 },
        children: [para(txt(L.toolCol, { size: 18, bold: true, color: GRAY, characterSpacing: 60 }))]
      }),
      new TableCell({
        width: { size: 1560, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: violetBorder },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [para(txt(L.yearsCol, { size: 18, bold: true, color: GRAY, characterSpacing: 60 }), { align: AlignmentType.CENTER })]
      }),
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        borders: { ...allNoBorder, bottom: violetBorder },
        margins: { top: 80, bottom: 80, left: 80, right: 120 },
        children: [para(txt(L.levelCol, { size: 18, bold: true, color: GRAY, characterSpacing: 60 }))]
      }),
    ]});

    const toolRows = (data.tools || []).map((tool, i) => new TableRow({ children: [
      new TableCell({
        width: { size: 5400, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT_GRAY : WHITE, type: ShadingType.CLEAR },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 160, bottom: 160, left: 120, right: 80 },
        children: [para(txt(tool.tool || '', { size: 22, bold: true }))]
      }),
      new TableCell({
        width: { size: 1560, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT_GRAY : WHITE, type: ShadingType.CLEAR },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 160, bottom: 160, left: 80, right: 80 },
        children: [para(txt(tool.years || '', { size: 22, bold: true, color: VIOLET }), { align: AlignmentType.CENTER })]
      }),
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT_GRAY : WHITE, type: ShadingType.CLEAR },
        borders: { ...allNoBorder, bottom: thinBorder },
        margins: { top: 160, bottom: 160, left: 80, right: 120 },
        children: [para(txt(tool.level || '', { size: 20, color: GRAY }))]
      }),
    ]}));

    // ── WHY FIT ───────────────────────────────────────────────────────────────
    const whyParagraphs = [
      sectionHead(L.whyFit),
      new Paragraph({
        spacing: sp(60, 240),
        border: { left: { style: BorderStyle.SINGLE, size: 20, color: LIME } },
        shading: { fill: LIME_LIGHT, type: ShadingType.CLEAR },
        indent: { left: 140, right: 0 },
        children: [txt(data.storytelling || data.why || '', { size: 22, italic: true, color: '374151' })]
      }),
    ];

    // ── GAP ANALYSIS ─────────────────────────────────────────────────────────
    const gapItems = Array.isArray(data.gap) ? data.gap : [];
    // backwards compat: if gap is a string, wrap it
    const gapList = gapItems.length > 0 ? gapItems
      : (typeof data.gap === 'string' && data.gap ? [{ title: 'Gap', detail: data.gap }] : []);

    const gapParagraphs = gapList.length > 0 ? [
      sectionHead(L.gap),
      ...gapList.map((g, i) => new Paragraph({
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

    // ── ASSEMBLE DOC ──────────────────────────────────────────────────────────
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

          // Two-column: contact + evaluation
          twoColTable(contactCard, evalCard),

          para([], { spacing: sp(0, 240) }),

          // Trajectory
          sectionHead(L.trajectory),
          ...trajectoryRows,
          para([], { spacing: sp(0, 200) }),

          // Tools
          sectionHead(L.tools),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [5400, 1560, 2400],
            rows: [toolsHeader, ...toolRows],
          }),

          // Why fit
          ...whyParagraphs,

          // Gap analysis
          ...gapParagraphs,

          // Footer
          footer,
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    // ── Send email copy ───────────────────────────────────────────────────────
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
              <p style="margin-top:20px;font-size:13px;color:#888;">El documento Word está adjunto a este mail.</p>
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
