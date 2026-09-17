// Extracción de texto de PDF con pdfjs-dist (build "legacy" pensado para
// Node — no necesita canvas/DOMMatrix para extraer texto, solo para
// renderizar páginas como imagen, que acá no hace falta).
//
// Reemplaza a pdf-parse@1.x, que tenía un bug real: fallaba con
// "bad XRef entry" en CUALQUIER PDF válido en cuanto se llamaba desde
// dentro de un handler de servidor (confirmado: fallaba incluso en un
// http.Server plano, sin formidable de por medio) — o sea, siempre rompía
// en producción. pdf-parse@2.x lo arregla pero trae una dependencia nativa
// (@napi-rs/canvas) que no cargaba bien en el runtime de Vercel
// ("DOMMatrix is not defined"). pdfjs-dist solo, sin esa dependencia
// nativa, funciona en ambos casos (probado en un http.Server local).
async function extractPdfText(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Sin esto, pdf.js intenta resolver su "fake worker" con un import()
  // dinámico que el empaquetado de funciones de Vercel no detecta ni
  // incluye — falla con "Cannot find module ...pdf.worker.mjs". Apuntando
  // el path a mano, entra directo sin depender de esa detección automática.
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}

module.exports = { extractPdfText };
