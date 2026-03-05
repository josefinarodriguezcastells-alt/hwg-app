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

    const labels = isEs
      ? { techFit:'Fit técnico', exp:'Experiencia', cult:'Culture fit', lang:'Idiomas', avail:'Disponibilidad', salary:'Pretensión salarial', tools:'Tools & Herramientas', tool:'Herramienta', years:'Años', level:'Nivel & contexto', why:'El candidato/a en 3 líneas', snapshot:'Quick Snapshot' }
      : { techFit:'Technical fit', exp:'Experience', cult:'Culture fit', lang:'Languages', avail:'Availability', salary:'Salary expectation', tools:'Tools & Stack', tool:'Tool', years:'Years', level:'Level & context', why:'The candidate in 3 lines', snapshot:'Quick Snapshot' };

    const VIOLET = '6C3BFF';
    const LIME = 'C8F135';
    const BLACK = '0F0F0F';
    const GRAY = '888888';
    const DARK = '374151';
    const LIGHT = 'F5F3FF';
    const WHY_BG = 'F9F6F1';

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const thinBottom = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' };
    const violetBottom = { style: BorderStyle.SINGLE, size: 12, color: VIOLET };

    const sectionLabel = (text) => new Paragraph({
      spacing: { before: 460, after: 140 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: LIME } },
      indent: { left: 140 },
      children: [new TextRun({ text, font: 'Arial', size: 20, bold: true, color: VIOLET, characterSpacing: 60 })]
    });

    const snapshotData = [
      [labels.techFit, data.snapshot.techFit],
      [labels.exp, data.snapshot.exp],
      [labels.cult, data.snapshot.cult],
      [labels.lang, data.snapshot.lang],
      [labels.avail, data.snapshot.avail],
      [labels.salary, data.snapshot.salary],
    ];

    const snapshotRows = snapshotData.map(([label, value]) => {
      const isDone = !value.includes('[COMPLETAR]');
      return new TableRow({ children: [
        new TableCell({
          width: { size: 400, type: WidthType.DXA },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
          margins: { top: 170, bottom: 170, left: 60, right: 80 },
          children: [new Paragraph({ children: [new TextRun({ text: isDone ? '✅' : '☐', font: 'Arial', size: 22 })] })]
        }),
        new TableCell({
          width: { size: 2600, type: WidthType.DXA },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
          margins: { top: 170, bottom: 170, left: 60, right: 160 },
          children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 22, bold: true, color: BLACK })] })]
        }),
        new TableCell({
          width: { size: 6360, type: WidthType.DXA },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
          margins: { top: 170, bottom: 170, left: 60, right: 60 },
          children: [new Paragraph({ children: [new TextRun({ text: value, font: 'Arial', size: 22, color: BLACK })] })]
        }),
      ]});
    });

    const toolsHeaderRow = new TableRow({ children: [
      new TableCell({
        width: { size: 5400, type: WidthType.DXA },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: violetBottom },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: labels.tool, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
      }),
      new TableCell({
        width: { size: 1560, type: WidthType.DXA },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: violetBottom },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: labels.years, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
      }),
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: violetBottom },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: labels.level, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
      }),
    ]});

    const toolRows = data.tools.map((tool, i) => new TableRow({ children: [
      new TableCell({
        width: { size: 5400, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
        margins: { top: 180, bottom: 180, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: tool.tool, font: 'Arial', size: 22, bold: true })] })]
      }),
      new TableCell({
        width: { size: 1560, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
        margins: { top: 180, bottom: 180, left: 120, right: 120 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: tool.years, font: 'Arial', size: 22, bold: true, color: VIOLET })] })]
      }),
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
        borders: { top: noBorder, left: noBorder, right: noBorder, bottom: thinBottom },
        margins: { top: 180, bottom: 180, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: tool.level, font: 'Arial', size: 22, color: GRAY })] })]
      }),
    ]}));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1728, right: 1728, bottom: 1728, left: 1728 }
          }
        },
        children: [
          // Name
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: data.name, font: 'Arial', size: 56, bold: true, color: BLACK })]
          }),
          // Role line
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: `${data.role}  ·  ${data.location}  ·  ${data.modality}`, font: 'Arial', size: 22, color: GRAY })]
          }),

          // PERSONAL INFORMATION
          sectionLabel(isEs ? 'INFORMACIÓN PERSONAL' : 'PERSONAL INFORMATION'),
          ...[ 
            [isEs ? 'Posición' : 'Position', data.personal?.position || '[COMPLETAR]'],
            [isEs ? 'Fecha de presentación' : 'Presentation date', today],
            ['LinkedIn', data.personal?.linkedin || '[COMPLETAR]'],
            [isEs ? 'Teléfono' : 'Phone', data.personal?.phone || '[COMPLETAR]'],
            ['Mail', data.personal?.email || '[COMPLETAR]'],
          ].map(([label, value]) => new Paragraph({
            spacing: { before: 0, after: 0 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' } },
            children: [
              new TextRun({ text: `${label}:  `, font: 'Arial', size: 22, bold: true, color: BLACK }),
              new TextRun({ text: value, font: 'Arial', size: 22, color: value === '[COMPLETAR]' ? GRAY : BLACK }),
            ]
          })),

          // QUICK SNAPSHOT
          sectionLabel(labels.snapshot.toUpperCase()),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [400, 2600, 6360],
            rows: snapshotRows
          }),

          // TOOLS
          sectionLabel(labels.tools.toUpperCase()),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [5400, 1560, 2400],
            rows: [toolsHeaderRow, ...toolRows]
          }),

          // WHY
          sectionLabel(labels.why.toUpperCase()),
          new Paragraph({
            spacing: { before: 60, after: 460 },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: LIME } },
            shading: { fill: WHY_BG, type: ShadingType.CLEAR },
            indent: { left: 140 },
            children: [new TextRun({ text: data.why, font: 'Arial', size: 22, italics: true, color: DARK })]
          }),

          // Footer
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' } },
            spacing: { before: 160, after: 0 },
            children: [
              new TextRun({ text: 'Presentado por ', font: 'Arial', size: 18, color: GRAY }),
              new TextRun({ text: 'HWG Talent Consultants', font: 'Arial', size: 18, bold: true, color: BLACK }),
              new TextRun({ text: `  ·  ${today}  ·  `, font: 'Arial', size: 18, color: GRAY }),
              new TextRun({ text: 'www.hwgtalent.com', font: 'Arial', size: 18, bold: true, color: VIOLET }),
            ]
          }),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    // Send email with docx attached
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS,
        }
      });

      const recruiterInfo = data.personal?.position ? ` — ${data.personal.position}` : '';

      await transporter.sendMail({
        from: `"HWG Form Generator" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `📋 Nuevo form: ${data.name}${recruiterInfo}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;color:#0F0F0F;">
            <div style="background:#0F0F0F;padding:16px 24px;border-radius:8px 8px 0 0;">
              <span style="color:#C8F135;font-weight:700;font-size:18px;">HWG</span>
              <span style="color:#fff;font-weight:700;font-size:18px;"> Talent Consultants</span>
            </div>
            <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
              <p style="font-size:15px;margin-bottom:16px;">Se generó un nuevo form de presentación:</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px 0;font-weight:700;width:160px;">Candidato</td><td>${data.name}</td></tr>
                <tr><td style="padding:8px 0;font-weight:700;">Rol</td><td>${data.role}</td></tr>
                ${data.personal?.position ? `<tr><td style="padding:8px 0;font-weight:700;">Posición</td><td>${data.personal.position}</td></tr>` : ''}
                <tr><td style="padding:8px 0;font-weight:700;">Fecha</td><td>${today}</td></tr>
              </table>
              <p style="margin-top:20px;font-size:13px;color:#888;">El documento Word está adjunto a este mail.</p>
            </div>
          </div>
        `,
        attachments: [{
          filename: `${data.name.replace(/\s+/g, '_')}_HWG.docx`,
          content: buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }]
      });
    } catch(mailErr) {
      console.error('Mail error:', mailErr.message);
      // Don't fail the request if email fails
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=presentacion_hwg.docx');
    res.status(200).send(buffer);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
