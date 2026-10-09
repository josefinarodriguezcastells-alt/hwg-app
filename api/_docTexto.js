// Texto de un documento guardado en Storage (CV o notas de entrevista): pdf, word o texto.
const { extractPdfText } = require('./_pdf-text');

async function textoDeUrl(url) {
  if (!url) return '';
  try {
    const r = await fetch(url);
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = String(url).split('?')[0].split('.').pop().toLowerCase();
    if (ext === 'pdf') return await extractPdfText(buf);
    if (ext === 'docx' || ext === 'doc') return (await require('mammoth').extractRawText({ buffer: buf })).value || '';
    return buf.toString('utf8');
  } catch (e) { return ''; }
}

module.exports = { textoDeUrl };
