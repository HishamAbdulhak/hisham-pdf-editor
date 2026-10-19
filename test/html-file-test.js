// Opens dist/Hishams-PDF-Editor.html from disk (file://) in a plain Chromium window
// (no desktop API) and runs edit + OCR + export. Run: electron test/html-file-test.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1400, height: 900, webPreferences: { partition: 'html-test' } });
  const errors = [];
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'Hishams-PDF-Editor.html'));
  await new Promise((r) => setTimeout(r, 1500));
  const b64 = fs.readFileSync(path.join(__dirname, 'sample.pdf')).toString('base64');
  try {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const app = window.pdfApp, T = window.pdfTools;
      const data = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
      const tab = await app.openFile({ path: null, name: 'sample.pdf', data });
      const e = tab.editor;
      await sleep(1200);
      const v = e.views[0];
      await e.showView(v);
      app.shared.props.font = 'ArSans';
      v.canvas.add(e.makeTextbox('نص عربي من ملف HTML', { left: 300, top: 700, width: 240, fontSize: 18, textAlign: 'right', direction: 'rtl' }));
      e.commit(v);
      const t0 = performance.now();
      await T.ocrPages(e, [1], ['eng', 'ara']);
      const ocrMs = Math.round(performance.now() - t0);
      const bytes = await app.exportPdf(e);
      const pdf = await T.loadPdfjs(bytes);
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
      await sleep(800);
      return { ok: true, singleFile: !!document.querySelector('script[data-asset]') || 'assets consumed', ocrMs, hasArabic: text.includes('نص عربي'), bytes: bytes.length };
    })()`);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'out', 'html-file.png'), img.toPNG());
    console.log(JSON.stringify({ ...result, errors }, null, 1));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err), errors }, null, 1));
  }
  app.quit();
});
