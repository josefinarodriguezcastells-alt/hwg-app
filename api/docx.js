const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat
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
    const DARK        = '1E1B2E';
    const VIOLET      = '7C3AED';
    const VIOLET_LIGHT= 'EDE9FE';
    const VIOLET_MID  = 'A78BFA';
    const GREEN       = '0F6E56';
    const GREEN_LIGHT = 'D1FAE5';
    const AMBER       = 'D97706';
    const AMBER_LIGHT = 'FFFBEB';
    const RED         = 'DC2626';
    const WHITE       = 'FFFFFF';
    const GRAY        = '6B7280';
    const LIGHT_GRAY  = 'F9FAFB';
    const BORDER      = 'E5E7EB';
    const TEXT        = '111827';
    const TEXT_MUTED  = '374151';

    // ── Labels ────────────────────────────────────────────────────────────────
    const L = isEs ? {
      contact:      'Información de contacto',
      metrics:      'Evaluación del candidato',
      techFit:      'Fit técnico',
      experience:   'Experiencia',
      cultureFit:   'Culture fit',
      english:      'Nivel de inglés',
      trajectory:   'Trayectoria profesional',
      tools:        'Stack técnico',
      whyFit:       'Por qué es fit para este rol',
      gap:          'Puntos de atención',
      scorecard:    'Scorecard de entrevista',
      linkedin:     'LinkedIn',
      phone:        'Teléfono',
      email:        'Email',
      salary:       'Pretensión salarial',
      availability: 'Disponibilidad',
      presentedBy:  'Presentado por',
      presentedFor: 'Presentado para',
      recommended:  'Recomendado para entrevistar',
    } : {
      contact:      'Contact information',
      metrics:      'Candidate evaluation',
      techFit:      'Technical fit',
      experience:   'Experience',
      cultureFit:   'Culture fit',
      english:      'English level',
      trajectory:   'Professional background',
      tools:        'Tech stack',
      whyFit:       'Why this candidate fits',
      gap:          'Points of attention',
      scorecard:    'Interview scorecard',
      linkedin:     'LinkedIn',
      phone:        'Phone',
      email:        'Email',
      salary:       'Salary expectation',
      availability: 'Availability',
      presentedBy:  'Presented by',
      presentedFor: 'Presented for',
      recommended:  'Recommended for interview',
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    const noBorder   = { style: BorderStyle.NONE, size: 0, color: WHITE };
    const allNoBorder= { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: BORDER };

    const sp = (before=0, after=0) => ({ before, after });

    const txt = (text, opts={}) => new TextRun({
      text: String(text || ''),
      font: 'Arial',
      size: opts.size || 22,
      bold: opts.bold || false,
      italics: opts.italic || false,
      color: opts.color || TEXT,
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

    const emptyPara = (before=0, after=0) => para([txt('')], { spacing: sp(before, after) });

    // Sección header con línea violeta izquierda
    const sectionHead = (label) => new Paragraph({
      spacing: sp(360, 120),
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: VIOLET } },
      indent: { left: 120 },
      children: [txt(label.toUpperCase(), { size: 17, bold: true, color: VIOLET, characterSpacing: 120 })]
    });

    // Fila de info con label a la izquierda y valor a la derecha
    const infoRow = (label, value, valueColor) => {
      const cellW = 9360;
      const labelW = 2400;
      const valueW = cellW - labelW;
      return new Table({
        width: { size: cellW, type: WidthType.DXA },
        columnWidths: [labelW, valueW],
        rows: [new TableRow({
          children: [
            new TableCell({
              width: { size: labelW, type: WidthType.DXA },
              borders: allNoBorder,
              margins: { top: 60, bottom: 60, left: 0, right: 80 },
              children: [para([txt(label, { size: 19, color: GRAY })], { spacing: sp(0,0) })]
            }),
            new TableCell({
              width: { size: valueW, type: WidthType.DXA },
              borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBorder },
              margins: { top: 60, bottom: 60, left: 80, right: 0 },
              children: [para([txt(String(value || '[—]'), { size: 19, bold: true, color: valueColor || TEXT })], { spacing: sp(0,0) })]
            }),
          ]
        })]
      });
    };

    // Métrica en caja (para el grid de evaluación)
    const metricBox = (label, value, color, width) => new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: allNoBorder,
      margins: { top: 100, bottom: 100, left: 80, right: 80 },
      shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
      children: [
        para([txt(String(value || '—'), { size: 32, bold: true, color: color || VIOLET })], { spacing: sp(0, 40), align: AlignmentType.CENTER }),
        para([txt(label, { size: 16, color: GRAY })], { spacing: sp(0, 0), align: AlignmentType.CENTER }),
      ]
    });

    // ── HEADER OSCURO ────────────────────────────────────────────────────────
    const rec = data.recommendation || '';
    const recColor = rec.toLowerCase().includes('no recom') ? RED
                   : rec.toLowerCase().includes('cautela') ? AMBER
                   : GREEN;

    // Simulamos header oscuro con shading en tabla de 2 col
    const headerTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [5800, 3560],
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 5800, type: WidthType.DXA },
            borders: allNoBorder,
            shading: { fill: DARK, type: ShadingType.CLEAR },
            margins: { top: 200, bottom: 140, left: 200, right: 120 },
            children: [
              para([txt('HWG Talent Consultants', { size: 17, color: VIOLET_MID })], { spacing: sp(0, 60) }),
              para([txt(data.name || '', { size: 44, bold: true, color: WHITE })], { spacing: sp(0, 60) }),
              para([
                txt((data.role || ''), { size: 20, color: VIOLET_MID }),
                txt(data.location ? '  ·  ' + data.location : '', { size: 20, color: '6D6A7C' }),
              ], { spacing: sp(0, 0) }),
            ]
          }),
          new TableCell({
            width: { size: 3560, type: WidthType.DXA },
            borders: allNoBorder,
            shading: { fill: DARK, type: ShadingType.CLEAR },
            margins: { top: 200, bottom: 140, left: 120, right: 200 },
            children: [
              para([txt(L.presentedFor, { size: 16, color: '6D6A7C' })], { spacing: sp(0, 40), align: AlignmentType.RIGHT }),
              para([txt(data.personal?.position || '', { size: 18, bold: true, color: WHITE })], { spacing: sp(0, 40), align: AlignmentType.RIGHT }),
              para([txt(data.personal?.position ? data.personal.position.split(' · ')[1] || '' : '', { size: 16, color: VIOLET_MID })], { spacing: sp(0, 80), align: AlignmentType.RIGHT }),
              para([txt(today, { size: 16, color: '6D6A7C' })], { spacing: sp(0, 0), align: AlignmentType.RIGHT }),
            ]
          }),
        ]
      })]
    });

    // Banda de veredicto (verde/rojo/amarillo bajo el header)
    const veredictoTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          width: { size: 9360, type: WidthType.DXA },
          borders: allNoBorder,
          shading: { fill: recColor, type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 200, right: 200 },
          children: [para([
            txt('● ', { size: 18, color: WHITE }),
            txt(rec || L.recommended, { size: 18, bold: true, color: WHITE }),
          ], { spacing: sp(0,0) })]
        })]
      })]
    });

    const headerSection = [headerTable, veredictoTable, emptyPara(200, 0)];

    // ── GRID DE MÉTRICAS (4 cajas) ───────────────────────────────────────────
    const metW = Math.floor(9360 / 4);
    const metricsGrid = data.snapshot ? [
      sectionHead(L.metrics),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [metW, metW, metW, metW],
        rows: [new TableRow({
          children: [
            metricBox(L.techFit, data.snapshot.techFit ? data.snapshot.techFit + ' / 10' : '—', VIOLET, metW),
            metricBox(L.experience, data.snapshot.exp || '—', TEXT, metW),
            metricBox(L.english, data.snapshot.englishLevel || '—', GREEN, metW),
            metricBox(L.availability, data.personal?.availability || data.snapshot?.avail || '—', GRAY, metW),
          ]
        })]
      }),
      emptyPara(0, 80),
    ] : [];

    // ── CONTACTO ─────────────────────────────────────────────────────────────
    const contactSection = [
      sectionHead(L.contact),
      infoRow(L.linkedin,     data.personal?.linkedin     || '—', VIOLET),
      infoRow(L.phone,        data.personal?.phone        || '—'),
      infoRow(L.email,        data.personal?.email        || '—'),
      infoRow(L.salary,       data.personal?.salary || data.snapshot?.salary || '—'),
      emptyPara(0, 80),
    ];

    // ── TRAYECTORIA ──────────────────────────────────────────────────────────
    const expItems = Array.isArray(data.experience) ? data.experience : [];
    const trajectorySection = expItems.length === 0 ? [] : [
      sectionHead(L.trajectory),
      ...expItems.flatMap((e, i) => [
        new Paragraph({
          spacing: sp(i === 0 ? 60 : 200, 40),
          children: [
            txt('  ', { size: 20 }),
            txt(e.role || '', { size: 22, bold: true, color: TEXT }),
          ]
        }),
        para([
          txt(e.company || '', { size: 20, bold: false, color: GRAY }),
          txt(e.period ? '   ·   ' + e.period : '', { size: 19, color: GRAY, italic: true }),
        ], { spacing: sp(0, 0), indent: { left: 240 } }),
      ]),
      emptyPara(0, 80),
    ];

    // ── STACK — pills en fila ─────────────────────────────────────────────────
    const tools = data.tools || [];
    const toolsSection = tools.length === 0 ? [] : [
      sectionHead(L.tools),
      ...chunkArray(tools, 4).map(rowTools => {
        const cellW2 = Math.floor(9360 / 4);
        const cells = rowTools.map(tool => new TableCell({
          width: { size: cellW2, type: WidthType.DXA },
          borders: allNoBorder,
          margins: { top: 60, bottom: 60, left: 60, right: 60 },
          shading: { fill: VIOLET_LIGHT, type: ShadingType.CLEAR },
          children: [new Paragraph({
            spacing: sp(0, 0),
            alignment: AlignmentType.CENTER,
            children: [
              txt(tool.tool || '', { size: 19, bold: true, color: VIOLET }),
              ...(tool.years ? [txt('  ' + tool.years + 'y', { size: 17, color: GRAY })] : []),
            ]
          })]
        }));
        while (cells.length < 4) {
          cells.push(new TableCell({
            width: { size: cellW2, type: WidthType.DXA },
            borders: allNoBorder,
            margins: { top: 60, bottom: 60, left: 60, right: 60 },
            children: [para([txt('')], {})]
          }));
        }
        return new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [cellW2, cellW2, cellW2, cellW2],
          rows: [new TableRow({ children: cells })]
        });
      }),
      emptyPara(0, 80),
    ];

    // ── POR QUÉ ES FIT ───────────────────────────────────────────────────────
    const whySection = [
      sectionHead(L.whyFit),
      new Paragraph({
        spacing: sp(60, 240),
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: GREEN } },
        shading: { fill: GREEN_LIGHT, type: ShadingType.CLEAR },
        indent: { left: 160 },
        children: [txt(data.storytelling || data.why || '', { size: 21, italic: true, color: TEXT_MUTED })]
      }),
    ];

    // ── SCORECARD ─────────────────────────────────────────────────────────────
    const scData = data.scorecard;
    const scorecardSection = scData && scData.items && scData.items.length > 0 ? [
      sectionHead(L.scorecard),
      para([
        txt(scData.template || '', { size: 18, color: VIOLET, italic: true }),
      ], { spacing: sp(40, 100) }),
      ...scData.items.map(item => {
        const isScale = /^[1-5]$/.test(String(item.value || ''));
        const fillPct = isScale ? Math.round(parseInt(item.value) / 5 * 9360) : 0;
        const emptyPct = 9360 - fillPct;
        if (isScale) {
          // Barra de progreso simulada con tabla de 2 celdas
          return [
            para([
              txt(item.label + '   ', { size: 19, bold: true, color: TEXT }),
              txt(item.value + ' / 5', { size: 19, bold: true, color: parseInt(item.value) >= 4 ? GREEN : parseInt(item.value) >= 3 ? AMBER : RED }),
            ], { spacing: sp(80, 30) }),
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [fillPct > 0 ? fillPct : 1, emptyPct > 0 ? emptyPct : 1],
              rows: [new TableRow({
                children: [
                  new TableCell({
                    width: { size: fillPct > 0 ? fillPct : 1, type: WidthType.DXA },
                    borders: allNoBorder,
                    shading: { fill: parseInt(item.value) >= 4 ? GREEN : parseInt(item.value) >= 3 ? AMBER : RED, type: ShadingType.CLEAR },
                    margins: { top: 30, bottom: 30, left: 0, right: 0 },
                    children: [para([txt('')], { spacing: sp(0,0) })]
                  }),
                  new TableCell({
                    width: { size: emptyPct > 0 ? emptyPct : 1, type: WidthType.DXA },
                    borders: allNoBorder,
                    shading: { fill: BORDER, type: ShadingType.CLEAR },
                    margins: { top: 30, bottom: 30, left: 0, right: 0 },
                    children: [para([txt('')], { spacing: sp(0,0) })]
                  }),
                ]
              })]
            }),
          ];
        }
        return [
          new Paragraph({
            spacing: sp(80, 30),
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: VIOLET_MID } },
            indent: { left: 120 },
            children: [
              txt(item.label + ':  ', { size: 19, bold: true, color: GRAY }),
              txt(String(item.value || ''), { size: 19, color: TEXT_MUTED }),
            ]
          }),
        ];
      }).flat(),
      ...(scData.recomendacion ? [
        new Paragraph({
          spacing: sp(160, 40),
          shading: { fill: scData.recomendacion.toLowerCase().includes('avanzar') ? GREEN_LIGHT : AMBER_LIGHT, type: ShadingType.CLEAR },
          border: { left: { style: BorderStyle.SINGLE, size: 20, color: scData.recomendacion.toLowerCase().includes('avanzar') ? GREEN : AMBER } },
          indent: { left: 160 },
          children: [
            txt('Recomendación:  ', { size: 20, bold: true, color: scData.recomendacion.toLowerCase().includes('avanzar') ? GREEN : AMBER }),
            txt(scData.recomendacion, { size: 20, bold: true, color: scData.recomendacion.toLowerCase().includes('avanzar') ? GREEN : AMBER }),
          ]
        }),
      ] : []),
      emptyPara(0, 80),
    ] : [];

    // ── GAP ANALYSIS ─────────────────────────────────────────────────────────
    const gapItems = Array.isArray(data.gap) ? data.gap
      : (typeof data.gap === 'string' && data.gap ? [{ title: 'Gap', detail: data.gap }] : []);

    const gapSection = gapItems.length > 0 ? [
      sectionHead(L.gap),
      ...gapItems.map((g, i) => new Paragraph({
        spacing: sp(i === 0 ? 60 : 100, 60),
        border: {
          left: { style: BorderStyle.SINGLE, size: 20, color: AMBER },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
        },
        shading: { fill: AMBER_LIGHT, type: ShadingType.CLEAR },
        indent: { left: 160 },
        children: [
          txt((g.title || '') + ':  ', { size: 21, bold: true, color: AMBER }),
          txt(g.detail || '', { size: 21, color: TEXT_MUTED }),
        ]
      })),
      emptyPara(0, 160),
    ] : [];

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const footerTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 4680],
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            borders: { top: thinBorder, bottom: noBorder, left: noBorder, right: noBorder },
            margins: { top: 120, bottom: 0, left: 0, right: 0 },
            children: [para([
              txt('HWG Talent Consultants', { size: 17, bold: true, color: TEXT }),
              txt('   ·   www.hwgtalent.com', { size: 17, color: VIOLET }),
            ], { spacing: sp(0,0) })]
          }),
          new TableCell({
            width: { size: 4680, type: WidthType.DXA },
            borders: { top: thinBorder, bottom: noBorder, left: noBorder, right: noBorder },
            margins: { top: 120, bottom: 0, left: 0, right: 0 },
            children: [para([txt(today, { size: 17, color: GRAY })], { spacing: sp(0,0), align: AlignmentType.RIGHT })]
          }),
        ]
      })]
    });

    // ── ASSEMBLE ──────────────────────────────────────────────────────────────
    const doc = new Document({
      numbering: {
        config: [
          { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } } }] }
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
          }
        },
        children: [
          ...headerSection,
          ...metricsGrid,
          ...contactSection,
          ...trajectorySection,
          ...toolsSection,
          ...whySection,
          ...scorecardSection,
          ...gapSection,
          footerTable,
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    // ── Email notification ────────────────────────────────────────────────────
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      const posInfo = data.personal?.position ? ` — ${data.personal.position}` : '';
      await transporter.sendMail({
        from: `"HWG Form Generator" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `📋 Nuevo form: ${data.name}${posInfo}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">
            <div style="background:#1E1B2E;padding:16px 24px;border-radius:8px 8px 0 0;">
              <span style="color:#7c3aed;font-weight:700;font-size:18px;">HWG</span>
              <span style="color:#fff;font-weight:700;font-size:18px;"> Talent Consultants</span>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin-bottom:16px;">Nuevo form generado:</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px 0;font-weight:700;width:160px;">Candidato</td><td>${data.name}</td></tr>
                <tr><td style="padding:8px 0;font-weight:700;">Rol</td><td>${data.role || '—'}</td></tr>
                ${data.personal?.position ? `<tr><td style="padding:8px 0;font-weight:700;">Posición</td><td>${data.personal.position}</td></tr>` : ''}
                ${data.recommendation ? `<tr><td style="padding:8px 0;font-weight:700;">Recomendación</td><td>${data.recommendation}</td></tr>` : ''}
                <tr><td style="padding:8px 0;font-weight:700;">Fecha</td><td>${today}</td></tr>
              </table>
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
