// Document tools: page numbers, watermark, password round-trip, split, images, compress, OCR, redact.
const out = {};
const T = window.pdfTools;
const data = await window.pdfeTest.read('test/sample.pdf');
const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
const e = tab.editor;
await sleep(800);
const textOf = async (bytes, n) => (await (await (await T.loadPdfjs(bytes)).getPage(n)).getTextContent()).items.map((i) => i.str).filter((s) => s.trim()).join(' | ');

await T.addPageNumbers(e, { style: 'pageOfN', position: 'bottom-center', start: 1, skipFirst: false, size: 11, color: '#333333' });
await T.addWatermark(e, { text: 'سري CONFIDENTIAL', size: 50, angle: 45, opacity: 0.2, color: '#d92d20', bold: true, pages: 'all' });
const bytes = await app.exportPdf(e, { encrypt: false });
await renderPdf(bytes, 't2-numbers-watermark', 1, 1);
await renderPdf(bytes, 't2-numbers-watermark', 2, 1);
out.page2Text = await textOf(bytes, 2);

// Password round trip
e.protect = { userPassword: 'secret123' };
const locked = await app.exportPdf(e);
try { await T.loadPdfjs(locked); out.lockedOpensWithoutPassword = true; } catch (err) { out.lockedNeedsPassword = err.name; }
const t3 = app.tabs.add();
await t3.editor.open({ data: locked, name: 'locked.pdf', password: 'secret123' });
out.unlockedPages = t3.editor.views.length;
e.protect = null;

// Split + export images
const files = await T.splitPdf(e, T.splitGroups('ranges', 0, '1, 2', 2));
out.split = files.map((f) => `${f.name} (${f.data.length} bytes)`);
const imgs = await T.pagesToImages(e, [0], { format: 'jpg', dpi: 150 });
out.image = `${imgs[0].name} ${imgs[0].data.length} bytes`;

// Images -> PDF, then OCR that "scan"
const blob = new Blob([imgs[0].data], { type: 'image/jpeg' });
const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
const scanBytes = await T.imagesToPdf([{ dataUrl }], { size: 'A4', margin: 0 });
const scan = await app.openFile({ path: null, name: 'scan.pdf', data: scanBytes });
await sleep(800);
out.scanNeedsOcr = await T.pagesNeedingOcr(scan.editor);
const t0 = performance.now();
await T.ocrPages(scan.editor, [0], ['eng', 'ara']);
out.ocrSeconds = Math.round((performance.now() - t0) / 100) / 10;
out.ocrText = (await scan.editor.views[0].pdfPage.getTextContent()).items.map((i) => i.str).join(' ').slice(0, 300);

// Compress the scan
const before = (await app.exportPdf(scan.editor)).length;
let n = 0;
await scan.editor.pageOp(async (doc, models) => { n = await T.compressImages(doc, 'low'); return models; });
out.compress = { before, after: (await app.exportPdf(scan.editor)).length, imagesReplaced: n };

// Redact the "Prepared by" line on the original
app.tabs.activate(tab);
await sleep(500);
const v = e.views[0];
await e.showView(v);
await v.loadContentInfo();
const run = v.runs.find((r) => r.str.startsWith('Prepared'));
v.canvas.add(new T.fabric.Rect({ left: run.x - 2, top: run.top - 2, width: run.w + 4, height: run.h + 4, originX: 'left', originY: 'top', meta: { kind: 'redact' } }));
e.commit(v);
await T.applyRedactions(e, { ocr: true });
const red = await app.exportPdf(e);
const redText = await textOf(red, 1);
out.redactedStillHasName = /John Smith/.test(redText);
out.redactedOcrFoundTitle = /Quarterly/i.test(redText);
await renderPdf(red, 't2-redacted', 1, 1);
return out;
