// Shared helpers prepended to UI tests.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = window.pdfApp;
// Renders page `n` (1-based) of PDF bytes to a PNG in test/out (via the app's pdf.js).
async function renderPdf(bytes, name, n = 1, scale = 1.5, clip) {
  const tab = await app.openFile({ path: null, name: `${name}.pdf`, data: bytes });
  await sleep(300);
  const page = tab.editor.views[n - 1].pdfPage;
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  let out = c;
  if (clip) {
    out = document.createElement('canvas');
    out.width = clip.w * scale; out.height = clip.h * scale;
    out.getContext('2d').drawImage(c, clip.x * scale, clip.y * scale, out.width, out.height, 0, 0, out.width, out.height);
  }
  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  await window.pdfeTest.write(`${name}-p${n}.png`, new Uint8Array(await blob.arrayBuffer()));
  return tab;
}
// True if `needle` (e.g. hex-encoded text) appears in any stream of the PDF, compressed or not.
async function rawContains(bytes, needle) {
  const s = new TextDecoder('latin1').decode(bytes);
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const body = bytes.slice(start, s.indexOf('endstream', start));
    let text = new TextDecoder('latin1').decode(body);
    try { text = new TextDecoder('latin1').decode(await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch { /* not compressed */ }
    if (text.toUpperCase().includes(needle.toUpperCase())) return true;
  }
  return false;
}
// Checks: expect() records a failure, done() throws if any were recorded (so run.sh exits 1).
function expect(out, ok, what) { if (!ok) (out.failed ||= []).push(what); }
function done(out) {
  if (out.failed?.length) throw new Error(`failed: ${out.failed.join('; ')} | ${JSON.stringify(out)}`);
  return out;
}
