// OCR: recognise text on scanned pages (English + Arabic, fully offline) and add
// an invisible text layer so the page can be searched, selected and edited.
import { createWorker } from 'tesseract.js';
import {
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  setTextRenderingMode, TextRenderingMode, setCharacterSqueeze, rgb,
} from '@cantoo/pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { FontSet, hasArabic } from './fonts.js';
import { invert, mul } from './matrix.js';
import { assetUrl } from './assets.js';

let cached = null; // { langs, worker }

// tesseract.js fetches "<langPath>/<lang>.traineddata.gz" inside its worker. A tiny
// wrapper script redirects those requests to the bundled files, so nothing goes online.
function workerWrapperUrl() {
  const files = { eng: assetUrl('ocr/eng.traineddata.gz'), ara: assetUrl('ocr/ara.traineddata.gz') };
  const src = `
    const files = ${JSON.stringify(files)};
    const realFetch = self.fetch.bind(self);
    self.fetch = (url, opts) => {
      const m = String(url).match(/\\/(\\w+)\\.traineddata(?:\\.gz)?$/);
      return realFetch(m && files[m[1]] ? files[m[1]] : url, opts);
    };
    importScripts(${JSON.stringify(assetUrl('ocr/worker.min.js'))});
  `;
  return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

async function getWorker(langs, onProgress) {
  const key = langs.join('+');
  if (cached?.key === key) return cached.worker;
  await releaseOcr();
  let core = assetUrl('ocr/core.wasm.js');
  if (!core.endsWith('.js')) core += '#.js'; // blob: URL — tesseract wants a .js-looking path
  const worker = await createWorker(key, 1, {
    workerPath: workerWrapperUrl(),
    workerBlobURL: false,
    corePath: core,
    langPath: 'https://offline.invalid/ocr',
    cacheMethod: 'none',
    gzip: true,
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  cached = { key, worker };
  return worker;
}

export async function releaseOcr() {
  if (cached) { const w = cached.worker; cached = null; await w.terminate().catch(() => {}); }
}

/** Runs OCR on an image/canvas and returns words with boxes in canvas pixels. */
export async function recognizeCanvas(canvas, langs, onProgress) {
  const worker = await getWorker(langs, onProgress);
  canvas = toGreyscale(canvas);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const words = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) {
          if (!w.text?.trim() || w.confidence < 15) continue;
          const bl = line.baseline;
          const cx = (w.bbox.x0 + w.bbox.x1) / 2;
          const t = bl && bl.x1 !== bl.x0 ? (cx - bl.x0) / (bl.x1 - bl.x0) : 0;
          const baseline = bl ? bl.y0 + (bl.y1 - bl.y0) * t : w.bbox.y1;
          words.push({ text: w.text, ...w.bbox, baseline: Math.min(Math.max(baseline, w.bbox.y0 + 1), w.bbox.y1) });
        }
      }
    }
  }
  return words;
}

// High-contrast greyscale copy: coloured headings and tinted backgrounds OCR much better.
function toGreyscale(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Stretch contrast so mid-dark colours become clearly dark.
    const v = Math.max(0, Math.min(255, (lum - 60) * 1.6));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Adds invisible text for OCR words to a pdf-lib page.
 * words are in pixels of an image rendered at `k` pixels per point of the displayed page;
 * vpT is the scale-1 pdf.js viewport transform of that page.
 */
export async function addInvisibleText(page, fonts, vpT, words, k) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...invert(vpT)), setTextRenderingMode(TextRenderingMode.Invisible));
  for (const w of words) {
    const x0 = w.x0 / k, x1 = w.x1 / k, top = w.y0 / k, base = w.baseline / k;
    const size = Math.max(3, (base - top) / 0.72);
    let lay;
    try { lay = await fonts.layout(w.text, { family: hasArabic(w.text) ? 'ArSans' : 'Helvetica', size }); } catch { continue; }
    if (!lay.width) continue;
    const squeeze = ((x1 - x0) / lay.width) * 100;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...mul([1, 0, 0, 1, x0, base], [1, 0, 0, -1, 0, 0])),
      setCharacterSqueeze(squeeze),
    );
    let x = 0;
    for (const run of lay.runs) {
      page.drawText(run.text, { x, y: 0, size, font: run.font, color: rgb(0, 0, 0) });
      x += run.width;
    }
    page.pushOperators(popGraphicsState());
  }
  page.pushOperators(popGraphicsState());
}

/** Renders a page of the editor's current PDF to a canvas sized for OCR. Returns {canvas, k}. */
export async function renderForOcr(view, maxPixels = 4200) {
  const k = Math.min(300 / 72, maxPixels / Math.max(view.W, view.H));
  const vp = view.viewport(k);
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  await view.pdfPage.render({ canvasContext: g, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
  return { canvas: c, k };
}

/** Pages with (almost) no selectable text — likely scans. */
export async function pagesNeedingOcr(editor) {
  const out = [];
  for (const v of editor.views) {
    const tc = await v.pdfPage.getTextContent();
    const chars = tc.items.reduce((n, it) => n + (it.str?.trim().length || 0), 0);
    if (chars < 20) out.push(v.index);
  }
  return out;
}

/** OCRs the given pages of an editor's document as one undoable step. */
export async function ocrPages(editor, indices, langs, onProgress) {
  await editor.pageOp(async (doc, models) => {
    const fonts = new FontSet(doc);
    for (const [n, i] of indices.entries()) {
      const view = editor.views[i];
      const { canvas, k } = await renderForOcr(view);
      const words = await recognizeCanvas(canvas, langs, (p) => onProgress?.((n + p) / indices.length, i));
      await addInvisibleText(doc.getPage(i), fonts, view.vpT, words, k);
    }
    return models;
  });
}
