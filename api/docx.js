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
    const LIGHT = 'F5F3FF';

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const thinBottom = { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' };
    const violetBottom = { style: BorderStyle.SINGLE, size: 12, color: VIOLET };

    // Empty spacer paragraph
    const spacer = (size = 200) => new Paragraph({ spacing: { before: 0, after: size }, children: [] });

    // Section label
    const sectionLabel = (text) => new Paragraph({
      spacing: { before: 600, after: 240 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: LIME } },
      indent: { left: 180 },
      children: [new TextRun({
        text: text.toUpperCase(),
        font: 'Arial',
        size: 20,
        bold: true,
        color: VIOLET,
        characterSpacing: 60
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
            width: { size: 440, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
            margins: { top: 140, bottom: 140, left: 0, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: isDone ? '✅' : '☐', size: 22, font: 'Arial' })] })]
          }),
          new TableCell({
            width: { size: 2600, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
            margins: { top: 140, bottom: 140, left: 0, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 22, bold: true, color: BLACK })] })]
          }),
          new TableCell({
            width: { size: 6320, type: WidthType.DXA },
            borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
            margins: { top: 140, bottom: 140, left: 0, right: 0 },
            children: [new Paragraph({ children: [new TextRun({ text: value, font: 'Arial', size: 22, color: BLACK })] })]
          }),
        ]
      });
    });

    // Tools header row
    const toolsHeaderRow = new TableRow({
      children: [
        new TableCell({
          width: { size: 4200, type: WidthType.DXA },
          borders: { top: noBorder, bottom: { style: violetBottom.style, size: violetBottom.size, color: violetBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: labels.tool, font: 'Arial', size: 19, bold: true, color: GRAY })] })]
        }),
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          borders: { top: noBorder, bottom: { style: violetBottom.style, size: violetBottom.size, color: violetBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: labels.years, font: 'Arial', size: 19, bold: true, color: GRAY })] })]
        }),
        new TableCell({
          width: { size: 3360, type: WidthType.DXA },
          borders: { top: noBorder, bottom: { style: violetBottom.style, size: violetBottom.size, color: violetBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: labels.level, font: 'Arial', size: 19, bold: true, color: GRAY })] })]
        }),
      ]
    });

    const toolRows = data.tools.map((tool, i) => new TableRow({
      children: [
        new TableCell({
          width: { size: 4200, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 140, bottom: 140, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: tool.tool, font: 'Arial', size: 22, bold: true })] })]
        }),
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 140, bottom: 140, left: 120, right: 120 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: tool.years, font: 'Arial', size: 22, bold: true, color: VIOLET })] })]
        }),
        new TableCell({
          width: { size: 3360, type: WidthType.DXA },
          shading: { fill: i % 2 === 0 ? LIGHT : 'FFFFFF', type: ShadingType.CLEAR },
          borders: { top: noBorder, bottom: { style: thinBottom.style, size: thinBottom.size, color: thinBottom.color }, left: noBorder, right: noBorder },
          margins: { top: 140, bottom: 140, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: tool.level, font: 'Arial', size: 22, color: GRAY })] })]
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
          // Name
          new Paragraph({
            spacing: { before: 0, after: 160 },
            children: [new TextRun({ text: data.name, font: 'Arial', size: 56, bold: true, color: BLACK })]
          }),
          // Role line
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: `${data.role} · ${data.location} · ${data.modality}`, font: 'Arial', size: 22, color: GRAY })]
          }),

          // QUICK SNAPSHOT
          sectionLabel(labels.snapshot),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [440, 2600, 6320],
            rows: snapshotRows
          }),

          // TOOLS
          sectionLabel(labels.tools),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [4200, 1800, 3360],
            rows: [toolsHeaderRow, ...toolRows]
          }),

          // WHY
          sectionLabel(labels.why),
          new Paragraph({
            spacing: { before: 0, after: 0 },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: LIME } },
            indent: { left: 200, right: 0 },
            children: [new TextRun({ text: data.why, font: 'Arial', size: 22, italics: true, color: '374151' })]
          }),

          spacer(600),

          // Footer
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' } },
            spacing: { before: 200, after: 0 },
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
