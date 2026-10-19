// Printing: render the edited PDF to page images and use the system print dialog.
import { exportPdf } from './exporter.js';
import { loadPdfjs } from './editor.js';

export async function printDoc(editor, onProgress, dpi = 150) {
  const pdf = await loadPdfjs(await exportPdf(editor, { encrypt: false }));
  const root = document.createElement('div');
  root.id = 'print-root';
  const urls = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.((i - 1) / pdf.numPages);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = new Image();
      img.src = url;
      // Landscape pages get their own orientation when printed.
      img.className = vp.width > vp.height ? 'landscape' : 'portrait';
      root.appendChild(img);
    }
  } finally {
    pdf.loadingTask?.destroy();
  }
  document.body.appendChild(root);
  await Promise.all([...root.querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
  const cleanup = () => {
    root.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 60000);
}
