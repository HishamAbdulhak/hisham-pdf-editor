// Core flow: open, edit text, fill form, add Arabic text, markup, comment, stamp, export, reopen.
const data = await window.pdfeTest.read('test/sample.pdf');
const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
const e = tab.editor;
await sleep(1200);
const v = e.views[0];
await e.showView(v);
await v.loadContentInfo();
const out = { runs: v.runs.map((r) => r.str), paras: v.paragraphs.filter((p) => p.runs.length > 1).length };
// 1. Edit a line of text
const run = v.runs.find((r) => r.str.startsWith('Prepared'));
e.editText(v, { item: run, para: null }, new MouseEvent('mousedown', { clientX: 5, clientY: 5 }));
let tb = v.canvas.getActiveObject(); tb.text = 'Prepared by: Hisham'; tb.initDimensions(); tb.exitEditing();
// 2. Fill form fields through pdf.js storage
const fields = await e.fieldObjects();
out.fieldKeys = Object.keys(fields || {});
if (!fields.name) return out;
e.pdf.annotationStorage.setValue(fields.name[0].id, { value: 'Hisham Abdulhak' });
e.pdf.annotationStorage.setValue(fields.agree[0].id, { value: true });
// 3. Arabic + mixed text box
app.shared.props.font = 'Naskh';
const ar = e.makeTextbox('مرحبا بالعالم 2026 Hello', { left: 330, top: 640, width: 220, fontSize: 18, textAlign: 'right', direction: 'rtl' });
v.canvas.add(ar); e.commit(v);
app.shared.props.font = 'Helvetica';
// 4. Markup over the Times paragraph
const times = v.runs.find((r) => r.str.startsWith('This paragraph'));
e.addMarkup(v, [{ x: times.x, y: times.top, w: times.w, h: times.h }], 'highlight', '#ffe066');
e.addMarkup(v, [{ x: times.x, y: times.top, w: 120, h: times.h }], 'underline', '#2f6fed');
// 5. Comment + stamp
const note = e.makeNote({ x: 500, y: 80 }, 'Please check the name.');
v.canvas.add(note); e.commit(v);
e.currentPage = 0;
await e.addStamp('Approved', { date: true });
await sleep(500);
await window.pdfeTest.shot('t1-editing');
// Export and reopen
const bytes = await app.exportPdf(e);
await window.pdfeTest.write('t1-out.pdf', bytes);
const tab2 = await app.openFile({ path: null, name: 't1-out.pdf', data: bytes });
await sleep(1500);
const v2 = tab2.editor.views[0];
const tc = await v2.pdfPage.getTextContent();
const annots = await v2.pdfPage.getAnnotations();
out.exportedText = tc.items.map((i) => i.str).filter((s) => s.trim()).join(' | ');
out.annotations = annots.map((a) => `${a.subtype}:${a.fieldName || ''}:${a.fieldValue ?? a.contentsObj?.str ?? ''}`);
out.undo = e.undoStack.length;
await window.pdfeTest.shot('t1-exported');
await renderPdf(bytes, 't1-render', 1, 2, { x: 50, y: 560, w: 520, h: 160 });
return out;
