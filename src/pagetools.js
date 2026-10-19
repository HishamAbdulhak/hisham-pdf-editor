// Whole-document tools: page numbers, watermarks, split/extract, images <-> PDF.
import {
  PDFDocument, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
} from '@cantoo/pdf-lib';
import { invert, mul } from './matrix.js';
import { FontSet } from './fonts.js';
import { exportPdf, embedImage } from './exporter.js';
import { loadPdfjs } from './editor.js';
import { t } from './i18n.js';

// Runs `draw` with a coordinate frame matching what the user sees on screen:
// origin top-left of the displayed page, y down, units = points.
export function inDisplayFrame(page, vpT, draw) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...invert(vpT)));
  try { draw(); } finally { page.pushOperators(popGraphicsState()); }
}

// Draws one line of text in the display frame with its baseline at (x, y), y down.
export async function drawDisplayText(page, fonts, text, { x, y, size, family = 'Helvetica', bold = false, color = rgb(0, 0, 0), opacity = 1, angle = 0, anchor = 'left' }) {
  const lay = await fonts.layout(text, { family, bold, size });
  let dx = 0;
  if (anchor === 'center') dx = -lay.width / 2;
  else if (anchor === 'right') dx = -lay.width;
  const a = (angle * Math.PI) / 180;
  // Flip back to y-up locally so glyphs aren't mirrored, then rotate (counter-clockwise on screen for positive angle).
  const m = mul([1, 0, 0, 1, x, y], mul([Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a), 0, 0], [1, 0, 0, -1, 0, 0]));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  let cx = dx;
  for (const run of lay.runs) {
    page.drawText(run.text, { x: cx, y: 0, size, font: run.font, color, opacity });
    cx += run.width;
  }
  page.pushOperators(popGraphicsState());
  return lay.width;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const NUMBER_STYLES = {
  n: (i) => `${i}`,
  pageOfN: (i, n) => t('Page {i} of {n}', { i, n }),
  slash: (i, n) => `${i} / ${n}`,
};

export function addPageNumbers(editor, { style = 'n', position = 'bottom-center', start = 1, skipFirst = false, size = 11, color = '#333333' }) {
  return editor.pageOp(async (doc, models) => {
    const fonts = new FontSet(doc);
    const pages = doc.getPages();
    const total = pages.length - (skipFirst ? 1 : 0);
    const [vert, horiz] = position.split('-');
    for (let i = 0; i < pages.length; i++) {
      if (skipFirst && i === 0) continue;
      const v = editor.views[i];
      const num = start + i - (skipFirst ? 1 : 0);
      const text = NUMBER_STYLES[style](num, total + start - 1);
      const margin = 28;
      const x = horiz === 'left' ? margin : horiz === 'right' ? v.W - margin : v.W / 2;
      const y = vert === 'top' ? margin + size : v.H - margin;
      const page = pages[i];
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...invert(v.vpT)));
      await drawDisplayText(page, fonts, text, { x, y, size, color: hexToRgb(color), anchor: horiz });
      page.pushOperators(popGraphicsState());
    }
    return models;
  });
}

export function addWatermark(editor, { text, imageUrl, size = 60, angle = 45, opacity = 0.18, color = '#d92d20', bold = true, pages = 'all' }) {
  return editor.pageOp(async (doc, models) => {
    const fonts = new FontSet(doc);
    const ctx = { doc, images: new Map() };
    const list = doc.getPages();
    for (let i = 0; i < list.length; i++) {
      if (pages === 'current' && i !== editor.currentPage) continue;
      const v = editor.views[i];
      const page = list[i];
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...invert(v.vpT)));
      if (imageUrl) {
        const img = await embedImage(ctx, imageUrl);
        const k = Math.min((v.W * size) / 100 / img.width, (v.H * size) / 100 / img.height);
        const w = img.width * k, h = img.height * k;
        const a = (-angle * Math.PI) / 180;
        // Image drawn centred, rotated, in a y-up local frame.
        const m = mul([1, 0, 0, 1, v.W / 2, v.H / 2], mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0], [1, 0, 0, -1, 0, 0]));
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
        page.drawImage(img, { x: -w / 2, y: -h / 2, width: w, height: h, opacity });
        page.pushOperators(popGraphicsState());
      } else if (text) {
        // Baseline offset so the text's visual centre sits on the page centre.
        const a = (angle * Math.PI) / 180;
        const off = size * 0.35;
        await drawDisplayText(page, fonts, text, {
          x: v.W / 2 + off * Math.sin(a), y: v.H / 2 + off * Math.cos(a),
          size, bold, color: hexToRgb(color), opacity, angle, anchor: 'center',
        });
      }
      page.pushOperators(popGraphicsState());
    }
    return models;
  });
}

// "1-3, 5" -> [0,1,2,4]
export function parseRanges(text, max) {
  const out = [];
  for (const part of String(text).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw new Error(t('“{part}” is not a page number or range.', { part }));
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > max || a > b) throw new Error(t('Pages must be between 1 and {max}.', { max }));
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  if (!out.length) throw new Error(t('No pages chosen.'));
  return out;
}

// Groups of page indices for Split.
export function splitGroups(mode, n, ranges, total) {
  if (mode === 'each') return Array.from({ length: total }, (_, i) => [i]);
  if (mode === 'everyN') {
    const k = Math.max(1, n | 0);
    const groups = [];
    for (let i = 0; i < total; i += k) groups.push(Array.from({ length: Math.min(k, total - i) }, (_, j) => i + j));
    return groups;
  }
  return String(ranges).split(',').map((s) => s.trim()).filter(Boolean).map((part) => parseRanges(part, total));
}

const label = (g) => (g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`);

export async function splitPdf(editor, groups) {
  const full = await PDFDocument.load(await exportPdf(editor, { encrypt: false }));
  const base = editor.fileName.replace(/\.pdf$/i, '');
  const files = [];
  for (const g of groups) {
    const out = await PDFDocument.create();
    for (const p of await out.copyPages(full, g)) out.addPage(p);
    if (editor.protect?.userPassword) out.encrypt({ userPassword: editor.protect.userPassword, ownerPassword: editor.protect.userPassword });
    files.push({ name: `${base} (pages ${label(g)}).pdf`, data: await out.save() });
  }
  return files;
}

export async function extractPages(editor, indices) {
  const [file] = await splitPdf(editor, [indices]);
  return file;
}

// Renders pages (with edits) to PNG/JPG files.
export async function pagesToImages(editor, indices, { format = 'png', dpi = 150 }, onProgress) {
  const pdf = await loadPdfjs(await exportPdf(editor, { encrypt: false }));
  const base = editor.fileName.replace(/\.pdf$/i, '');
  const files = [];
  try {
    for (const [k, i] of indices.entries()) {
      onProgress?.(k / indices.length);
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
      files.push({ name: `${base} - page ${i + 1}.${format}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  } finally {
    pdf.loadingTask?.destroy();
  }
  return files;
}

const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792] };

// Builds a PDF with one image per page.
export async function imagesToPdf(images, { size = 'fit', margin = 0 }) {
  const doc = await PDFDocument.create();
  const ctx = { doc, images: new Map() };
  for (const im of images) {
    const img = await embedImage(ctx, im.dataUrl);
    let pw, ph;
    if (size === 'fit') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; } else {
      [pw, ph] = PAGE_SIZES[size];
      if (img.width > img.height) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const k = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return doc.save();
}

export { degrees };
