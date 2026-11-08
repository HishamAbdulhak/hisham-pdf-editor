// Regression checks for the audit fixes.
const out = {};
const data = await window.pdfeTest.read('test/sample.pdf');
const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
const e = tab.editor;
await sleep(800);
// 5. Typed form value survives undo of a page operation
const fields = await e.fieldObjects();
e.pdf.annotationStorage.setValue(fields.name[0].id, { value: 'Kept after undo' });
await e.rotatePage(1, 90);
await e.undo();
const annots = await e.views[0].pdfPage.getAnnotations();
out.formAfterUndo = annots.find((a) => a.fieldName === 'name')?.fieldValue;
// 4. Only 10 page operations stay undoable
for (let i = 0; i < 12; i++) await e.rotatePage(1, 90);
out.docUndoEntries = e.undoStack.filter((x) => x.type === 'doc').length;
// 7. Same file opened twice (no path) reuses the tab
const before = app.tabs.list.length;
await app.openFile({ path: null, name: 'sample.pdf', data });
out.tabsAddedForDuplicate = app.tabs.list.length - before;
// 3. Desktop refuses to read files that are not PDFs
try { await window.desktop.readPdf('package.json'); out.readNonPdf = 'allowed'; } catch { out.readNonPdf = 'refused'; }
// 8. Switching tools keeps thumbnails (no rebuild)
const thumb = document.querySelector('.thumb');
app.setTool('pen'); app.setTool('select');
out.thumbsKept = document.querySelector('.thumb') === thumb;
const ok = out.formAfterUndo === 'Kept after undo' && out.docUndoEntries === 10 && out.tabsAddedForDuplicate === 0 && out.readNonPdf === 'refused' && out.thumbsKept;
if (!ok) throw new Error(JSON.stringify(out));
return out;
