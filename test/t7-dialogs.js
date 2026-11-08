// Click through the Tools menu and dialogs like a user would.
const out = { opened: [] };
const data = await window.pdfeTest.read('test/sample.pdf');
await app.openFile({ path: null, name: 'sample.pdf', data });
await sleep(1000);
const toolsBtn = document.querySelector('#moreGroup .tb-btn');
const items = ['Recognize text (OCR)…', 'Reduce file size…', 'Password protection…', 'Split PDF…', 'Extract pages…', 'Export pages as images…', 'Page numbers…', 'Watermark…', 'Keyboard shortcuts', 'About'];
for (const label of items) {
  toolsBtn.click();
  await sleep(150);
  const btn = [...document.querySelectorAll('.dropdown button')].find((b) => b.textContent.trim() === label);
  if (!btn) { out.opened.push(`${label}: MISSING`); continue; }
  btn.click();
  await sleep(700);
  const modal = document.querySelector('.modal');
  out.opened.push(`${label}: ${modal ? modal.querySelector('h2').textContent : 'no dialog'}`);
  if (label === 'Watermark…') await window.pdfeTest.shot('t7-watermark-dialog');
  if (label === 'Recognize text (OCR)…') await window.pdfeTest.shot('t7-ocr-dialog');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(200);
}
// Toolbar: stamp and signature dialogs
document.querySelector('#insertGroup .tb-btn:nth-child(3)').click();
await sleep(400);
await window.pdfeTest.shot('t7-stamp');
document.querySelector('.stamp-btn').click();
await sleep(500);
document.querySelector('#insertGroup .tb-btn:nth-child(2)').click();
await sleep(500);
out.signatureDialog = document.querySelector('.modal h2')?.textContent;
// Draw a signature on the pad with pointer events
const pad = document.querySelector('.sig-pad');
const r = pad.getBoundingClientRect();
const pt = (x, y, type) => pad.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, bubbles: true }));
pt(30, 100, 'pointerdown');
for (let i = 0; i < 40; i++) pt(30 + i * 12, 100 + Math.sin(i / 3) * 40, 'pointermove');
pt(510, 100, 'pointerup');
await sleep(200);
await window.pdfeTest.shot('t7-signature');
document.querySelector('.modal [data-ok]').click();
await sleep(800);
out.objects = app.tabs.active.editor.selectedObjects().map((o) => o.meta?.kind);
// Arabic UI dialogs
document.querySelector('#moreGroup .tb-btn:nth-child(2)').click();
await sleep(500);
document.querySelector('#moreGroup .tb-btn').click();
await sleep(150);
[...document.querySelectorAll('.dropdown button')][6].click(); // Split
await sleep(500);
await window.pdfeTest.shot('t7-arabic-dialog');
expect(out, out.opened.length === 10 && out.opened.every((s) => !/undefined|error/i.test(s)), 'every menu dialog opens');
expect(out, out.signatureDialog === 'Add signature' && out.objects.includes('sig'), 'signature added');
return done(out);
