const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  HeadingLevel, UnderlineType
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
    const LIGHT = 'F9F6F1';

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
    const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' };
    const violetBorder = { style: BorderStyle.SINGLE, size: 12, color: VIOLET };

    // Section label paragraph
    const sectionLabel = (text) => new Paragraph({
      spacing: { before: 480, after: 160 },
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: LIME } },
      indent: { left: 160 },
      children: [new TextRun({
        text: text.toUpperCase(),
        font: 'Arial',
        size: 18,
        bold: true,
        color: VIOLET,
        characterSpacing: 40
      })]
    });

    // Snapshot rows
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
      return new TableRow({
        children: [
          new TableCell({
            width: { size: 400, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
            margins: { top: 100, bottom: 100, left: 0, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: isDone ? '✅' : '☐', size: 20, font: 'Arial' })] })]
          }),
          new TableCell({
            width: { size: 2400, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
            margins: { top: 100, bottom: 100, left: 0, right: 160 },
            children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: BLACK })] })]
          }),
          new TableCell({
            width: { size: 6560, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
            margins: { top: 100, bottom: 100, left: 0, right: 0 },
            children: [new Paragraph({ children: [new TextRun({ text: value, font: 'Arial', size: 20, color: BLACK })] })]
          }),
        ]
      });
    });

    // Tools rows
    const toolRows = data.tools.map((tool, i) => new TableRow({
      children: [
        new TableCell({
          width: { size: 3960, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
          margins: { top: 110, bottom: 110, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: tool.tool, font: 'Arial', size: 20, bold: true })] })]
        }),
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
          margins: { top: 110, bottom: 110, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: tool.years, font: 'Arial', size: 20, bold: true, color: VIOLET })] })]
        }),
        new TableCell({
          width: { size: 3600, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' }, left: noBorder, right: noBorder },
          margins: { top: 110, bottom: 110, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: tool.level, font: 'Arial', size: 20, color: GRAY })] })]
        }),
      ]
    }));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children: [
          // Header bar - name
          new Paragraph({
            spacing: { before: 0, after: 120 },
            children: [new TextRun({
              text: data.name,
              font: 'Arial',
              size: 52,
              bold: true,
              color: BLACK
            })]
          }),
          // Role / location / modality
          new Paragraph({
            spacing: { before: 0, after: 480 },
            children: [new TextRun({
              text: `${data.role} · ${data.location} · ${data.modality}`,
              font: 'Arial',
              size: 20,
              color: GRAY
            })]
          }),

          // QUICK SNAPSHOT
          sectionLabel(labels.snapshot),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [400, 2400, 6560],
            rows: snapshotRows
          }),

          // TOOLS
          sectionLabel(labels.tools),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [3960, 1800, 3600],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 3960, type: WidthType.DXA },
                    borders: { top: noBorder, bottom: violetBorder, left: noBorder, right: noBorder },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ children: [new TextRun({ text: labels.tool, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
                  }),
                  new TableCell({
                    width: { size: 1800, type: WidthType.DXA },
                    borders: { top: noBorder, bottom: violetBorder, left: noBorder, right: noBorder },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: labels.years, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
                  }),
                  new TableCell({
                    width: { size: 3600, type: WidthType.DXA },
                    borders: { top: noBorder, bottom: violetBorder, left: noBorder, right: noBorder },
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                    children: [new Paragraph({ children: [new TextRun({ text: labels.level, font: 'Arial', size: 18, bold: true, color: GRAY })] })]
                  }),
                ]
              }),
              ...toolRows
            ]
          }),

          // WHY
          sectionLabel(labels.why),
          new Paragraph({
            spacing: { before: 0, after: 480 },
            border: { left: { style: BorderStyle.SINGLE, size: 20, color: LIME } },
            indent: { left: 160 },
            shading: { fill: LIGHT, type: ShadingType.CLEAR },
            children: [new TextRun({
              text: data.why,
              font: 'Arial',
              size: 20,
              italics: true,
              color: '374151'
            })]
          }),

          // Footer
          new Paragraph({
            spacing: { before: 600 },
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' } },
            children: [
              new TextRun({ text: 'Presentado por ', font: 'Arial', size: 18, color: GRAY }),
              new TextRun({ text: 'HWG Talent Consultants', font: 'Arial', size: 18, bold: true, color: BLACK }),
              new TextRun({ text: ` · ${today} · `, font: 'Arial', size: 18, color: GRAY }),
              new TextRun({ text: 'www.hwgtalent.com', font: 'Arial', size: 18, bold: true, color: VIOLET }),
            ]
          }),
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=presentacion_hwg.docx');
    res.status(200).send(buffer);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
