// Fonts: editing existing text keeps its original font (embedded copy, installed font,
// look-alike), new letters fall back per character, and the saved PDF embeds those fonts.
const out = {};
const { fontlib } = window.pdfTools;
const data = await window.pdfeTest.read('test/fonts.pdf');
const tab = await app.openFile({ path: null, name: 'fonts.pdf', data });
const e = tab.editor;
await sleep(1200);
const v = e.views[0];
await e.showView(v);
await v.loadContentInfo();
out.pdfFonts = v.runs.map((r) => `${r.str} => ${r.font.pdfName} (${r.font.font}${r.font.bold ? ' bold' : ''})`);
app.setTool('edit');
const ev = () => new MouseEvent('mousedown', { clientX: 1, clientY: 1 });
const edit = async (prefix, text) => {
  const run = v.runs.find((r) => r.str.startsWith(prefix));
  const info = await e.editText(v, { item: run, para: null }, ev());
  const tb = v.canvas.getActiveObject();
  tb.text = text;
  tb.initDimensions();
  tb.exitEditing();
  e.commit(v);
  return { info, meta: tb.meta, css: tb.fontFamily, bold: tb.fontWeight };
};
// 1. Calibri (installed) with new letters not in the PDF's subset.
out.calibri = await edit('Quarterly', 'Quarterly sales grew in every region by 12% (Q4)');
// 2. Arial Bold (installed).
out.arial = await edit('Prepared', 'Prepared by the finance team and Hisham');
// 3. Lato: not installed, no look-alike -> PDF's own copy; we are asked before any download.
const latoP = edit('Lato', 'Lato is installed here');
await sleep(600);
const ask = document.querySelector('.toast.ask');
out.downloadAsked = ask?.textContent || null;
[...(ask?.querySelectorAll('button') || [])].find((b) => b.textContent === 'Not now')?.click();
out.lato = await latoP;
// 4. Look-alikes for fonts that are not installed.
out.helvetica = await fontlib.matchPdfFont('ABCDEF+Helvetica-Bold', { standard: true });
out.standardKept = (await fontlib.matchPdfFont('Times-Roman')) === null; // standard PDF fonts stay built-in
out.helveticaSource = (await fontlib.familyBytes('Helvetica', true, false))?.source;
out.parse = fontlib.parsePdfFontName('XYZABC+TimesNewRomanPS-BoldItalicMT');
// "Not now" only lasts this session: nothing is saved.
out.savedFontSettings = await window.desktop.storeGet('fonts', {});
// Re-picking the font a box already has keeps the PDF's own copy.
const latoBox = v.canvas.getObjects().find((o) => o.meta?.font === 'f:Lato');
v.canvas.setActiveObject(latoBox);
e.applyPropToSelection('font', 'f:Lato');
out.repickKeepsEmbedded = !!latoBox.meta.embedded;
v.canvas.discardActiveObject();
await sleep(300);
await window.pdfeTest.shot('t10-edited');
// Export and check which fonts the saved PDF uses.
const bytes = await app.exportPdf(e);
await window.pdfeTest.write('t10-out.pdf', bytes);
const tab2 = await app.openFile({ path: null, name: 't10-out.pdf', data: bytes });
await sleep(1500);
const p2 = tab2.editor.views[0].pdfPage;
const tc = await p2.getTextContent();
await p2.getOperatorList();
out.exportedText = tc.items.map((i) => i.str).filter((s) => s.trim()).join(' | ');
out.exportedFonts = [...new Set(tc.items.filter((i) => i.str.trim()).map((i) => {
  try { return p2.commonObjs.get(i.fontName)?.name; } catch { return '?'; }
}))];
await renderPdf(bytes, 't10-render', 1, 2, { x: 50, y: 80, w: 520, h: 140 });
const helveticaOut = out.exportedFonts.filter((n) => /Helvetica/.test(n || ''));
out.PASS = out.standardKept && out.calibri.info?.family === 'Calibri' && out.arial.info?.family === 'Arial' && !!out.lato.info?.embedded
  && !!out.downloadAsked && out.helvetica?.lookalike === 'Arimo' && out.helveticaSource === 'lookalike'
  && out.exportedFonts.some((n) => /Calibri/.test(n)) && out.exportedFonts.some((n) => /Arial/.test(n)) && out.exportedFonts.some((n) => /Lato/.test(n))
  && /12% \(Q4\)/.test(out.exportedText) && /Hisham/.test(out.exportedText) && !helveticaOut.length
  && !out.savedFontSettings?.declined && out.repickKeepsEmbedded;
if (!out.PASS) throw new Error(`font checks failed: ${JSON.stringify(out)}`);
return out;
