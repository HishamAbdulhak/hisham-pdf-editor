// Redaction: every page that has redaction boxes is flattened into a single image with
// black boxes burned in, so nothing under the boxes survives in the file. The page is
// then OCR'd so its remaining text is searchable again.
import * as fabric from 'fabric';
import * as pdfjsLib from 'pdfjs-dist';
import { FontSet } from './fonts.js';
import { recognizeCanvas, addInvisibleText } from './ocr.js';

const SCALE = 2.5; // ≈180 dpi

export async function applyRedactions(editor, { ocr = true, langs = ['eng', 'ara'] } = {}, onProgress) {
  const models0 = editor.snapshotModels();
  const pagesToDo = models0.map((m, i) => (m.json?.some((o) => o.meta?.kind === 'redact') ? i : -1)).filter((i) => i >= 0);
  if (!pagesToDo.length) return 0;
  await editor.pageOp(async (doc, models) => {
    const fonts = new FontSet(doc);
    for (const [n, i] of pagesToDo.entries()) {
      onProgress?.(n / pagesToDo.length, i);
      const view = editor.views[i];
      const json = models[i].json || [];
      const canvas = await flattenPage(editor, view, json);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      // New page in display orientation (rotation 0), same size as what the user saw.
      const page = doc.insertPage(i, [view.W, view.H]);
      page.drawImage(img, { x: 0, y: 0, width: view.W, height: view.H });
      doc.removePage(i + 1);
      // Keep sticky notes; everything else is now part of the image.
      models[i] = { id: models[i].id, json: json.filter((o) => o.meta?.kind === 'note') };
      if (ocr) {
        const words = await recognizeCanvas(canvas, langs, (p) => onProgress?.((n + p) / pagesToDo.length, i));
        await addInvisibleText(page, fonts, [1, 0, 0, -1, 0, view.H], words, SCALE);
      }
    }
    return models;
  });
  return pagesToDo.length;
}

async function flattenPage(editor, view, json) {
  const vp = view.viewport(SCALE);
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await view.pdfPage.render({
    canvasContext: g, viewport: vp,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE,
    annotationStorage: editor.pdf.annotationStorage,
  }).promise;

  // The user's own additions (except boxes and notes) are burned in too.
  const keep = json.filter((o) => !['redact', 'note'].includes(o.meta?.kind));
  if (keep.length) {
    const sc = new fabric.StaticCanvas(undefined, { width: c.width, height: c.height, enableRetinaScaling: false });
    sc.setViewportTransform([SCALE, 0, 0, SCALE, 0, 0]);
    sc.add(...(await fabric.util.enlivenObjects(keep)));
    sc.renderAll();
    g.drawImage(sc.getElement(), 0, 0);
    sc.dispose();
  }
  g.fillStyle = '#000';
  for (const o of await fabric.util.enlivenObjects(json.filter((x) => x.meta?.kind === 'redact'))) {
    o.setCoords();
    const b = o.getBoundingRect();
    g.fillRect(b.left * SCALE, b.top * SCALE, b.width * SCALE, b.height * SCALE);
  }
  return c;
}
