// Speed: open a 300-page PDF, jump around, measure.
const out = { appReadyMs: Math.round(performance.now()) };
const data = await window.pdfeTest.read('test/big.pdf');
const t0 = performance.now();
const tab = await app.openFile({ path: null, name: 'big.pdf', data });
const e = tab.editor;
out.openMs = Math.round(performance.now() - t0);
// Time until first page is drawn
const t1 = performance.now();
while (!e.views[0].renderedScale && performance.now() - t1 < 10000) await sleep(20);
out.firstPageMs = Math.round(performance.now() - t0);
// Jump to page 150 and wait for it to render
const t2 = performance.now();
e.scroller.scrollTop = e.views[149].el.offsetTop;
while (!e.views[149].renderedScale && performance.now() - t2 < 10000) await sleep(20);
out.jumpToPage150Ms = Math.round(performance.now() - t2);
// Scroll smoothness: frames during a 2-second scroll
let frames = 0, maxGap = 0, last = performance.now();
const tick = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; frames++; };
const start = performance.now();
await new Promise((resolve) => {
  const step = () => {
    tick();
    e.scroller.scrollTop += 40;
    if (performance.now() - start < 2000) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
});
out.scrollFps = Math.round(frames / 2);
out.worstFrameMs = Math.round(maxGap);
// Tool switch responsiveness
const t3 = performance.now();
app.setTool('pen'); app.setTool('select');
out.toolSwitchMs = Math.round(performance.now() - t3);
// Save (export) time
const t4 = performance.now();
await app.exportPdf(e);
out.exportMs = Math.round(performance.now() - t4);
out.activeCanvases = e.views.filter((v) => v.canvas).length;
// Generous limits (several times a normal PC) so only real slowdowns fail.
expect(out, out.openMs < 3000, 'open under 3 s');
expect(out, out.firstPageMs < 5000, 'first page under 5 s');
expect(out, out.jumpToPage150Ms < 3000, 'jump to page 150 under 3 s');
expect(out, out.toolSwitchMs < 1000, 'tool switch under 1 s');
expect(out, out.exportMs < 10000, 'export under 10 s');
expect(out, out.activeCanvases <= 8, 'only nearby pages keep a canvas');
return done(out);
