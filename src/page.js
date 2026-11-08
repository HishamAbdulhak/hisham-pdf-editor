// One PDF page on screen, as layers (bottom to top):
//   pdf canvas  → night-mode image patches → text layer (select/copy) → search hits
//   → form fields & links → hover box → Fabric overlay (the user's edits)
// Overlay coordinates are PDF points in display orientation (scale 1); the Fabric
// viewport transform applies the zoom.
import * as pdfjsLib from 'pdfjs-dist';
import * as fabric from 'fabric';
import { mul, apply } from './matrix.js';
import { hasArabic } from './fonts.js';

fabric.FabricObject.customProperties = ['meta'];
Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
  transparentCorners: false,
  cornerColor: '#ffffff',
  cornerStrokeColor: '#2f6fed',
  borderColor: '#2f6fed',
  cornerStyle: 'circle',
  cornerSize: 10,
  borderScaleFactor: 1.5,
  padding: 2,
});

// Baseline of the first text line, measured from the top of a Fabric Textbox,
// as a fraction of font size (fabric: _fontSizeMult * (1 - _fontSizeFraction)).
export const BASELINE = 1.13 * (1 - 0.222);

const OPS = pdfjsLib.OPS;

export class PageView {
  constructor(editor, model, index) {
    this.editor = editor;
    this.model = model;
    this.index = index;
    this.canvas = null;
    this.renderedScale = 0;
    this.renderTask = null;
    this.runs = null;
    this.paragraphs = null;
    this.images = null;
    this.loadToken = 0;
    this.textLayer = null;
    this.annotationLayer = null;

    const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    this.el = div('page');
    this.pdfCanvas = document.createElement('canvas');
    this.pdfCanvas.className = 'pdf-layer';
    this.nightLayer = div('night-layer');
    this.textEl = div('textLayer');
    this.searchEl = div('search-layer');
    this.annotEl = div('annotationLayer');
    this.hover = div('hover-box');
    this.hover.hidden = true;
    this.host = div('overlay');
    this.label = div('page-label');
    this.el.append(this.pdfCanvas, this.nightLayer, this.textEl, this.searchEl, this.annotEl, this.hover, this.host, this.label);
    this.setIndex(index);
    this.bindPassthrough();
  }

  setIndex(i) {
    this.index = i;
    this.el.dataset.index = i;
    this.label.textContent = `${i + 1}`;
  }

  async init(pdfDoc) {
    this.pdfPage = await pdfDoc.getPage(this.index + 1);
    const vp = this.pdfPage.getViewport({ scale: 1 });
    this.W = vp.width;
    this.H = vp.height;
    this.vpT = vp.transform;
    this.layout();
  }

  get scale() { return this.editor.scale; }
  viewport(scale = this.scale) { return this.pdfPage.getViewport({ scale }); }

  layout() {
    if (!this.pdfPage) return; // still loading
    const s = this.scale;
    const st = this.el.style;
    st.width = `${Math.round(this.W * s)}px`;
    st.height = `${Math.round(this.H * s)}px`;
    st.setProperty('--scale-factor', s);
    st.setProperty('--total-scale-factor', s);
    st.setProperty('--user-unit', 1);
    st.setProperty('--scale-round-x', '1px');
    st.setProperty('--scale-round-y', '1px');
    if (this.canvas) {
      this.canvas.setDimensions({ width: Math.round(this.W * s), height: Math.round(this.H * s) });
      this.canvas.setViewportTransform([s, 0, 0, s, 0, 0]);
    }
    const vp = this.viewport().clone({ dontFlip: true });
    if (this.textLayer) this.textLayer.update({ viewport: vp });
    if (this.annotationLayer) this.annotationLayer.update({ viewport: vp });
    this.hideHover();
    this.drawNight();
    this.drawSearch();
  }

  async render() {
    if (!this.pdfPage) return;
    const s = this.scale;
    if (this.renderedScale === s) return;
    if (this.renderTask) { this.renderTask.cancel(); this.renderTask = null; }
    const dpr = window.devicePixelRatio || 1;
    const viewport = this.viewport(s * dpr);
    const off = document.createElement('canvas');
    off.width = Math.floor(viewport.width);
    off.height = Math.floor(viewport.height);
    const task = this.pdfPage.render({
      canvasContext: off.getContext('2d'),
      viewport,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
      annotationStorage: this.editor.pdf.annotationStorage,
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.error(err);
      return;
    }
    if (this.renderTask !== task) return;
    this.renderTask = null;
    if (!off.width || !off.height) return; // document was replaced while this page was drawing
    // Swap in the finished render to avoid flashing a blank canvas.
    this.pdfCanvas.width = off.width;
    this.pdfCanvas.height = off.height;
    this.pdfCanvas.getContext('2d').drawImage(off, 0, 0);
    this.renderedScale = s;
    this.renderLayers().catch((e) => console.warn('layers', e));
  }

  release() {
    if (this.renderTask) { this.renderTask.cancel(); this.renderTask = null; }
    this.pdfCanvas.width = 0;
    this.pdfCanvas.height = 0;
    this.renderedScale = 0;
  }

  // Text layer (selection, copy) and annotation layer (form fields, links). Built once per page.
  async renderLayers() {
    if (this.layersBuilt) return;
    this.layersBuilt = true;
    const vp = this.viewport().clone({ dontFlip: true });
    this.textLayer = new pdfjsLib.TextLayer({
      textContentSource: this.pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container: this.textEl,
      viewport: vp,
    });
    await this.textLayer.render();
    const annotations = await this.pdfPage.getAnnotations({ intent: 'display' });
    if (!annotations.length) return;
    this.annotationLayer = new pdfjsLib.AnnotationLayer({
      div: this.annotEl,
      page: this.pdfPage,
      viewport: vp,
      annotationStorage: this.editor.pdf.annotationStorage,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      structTreeLayer: null,
      linkService: this.editor.linkService,
    });
    await this.annotationLayer.render({
      annotations,
      viewport: vp,
      linkService: this.editor.linkService,
      renderForms: true,
      annotationStorage: this.editor.pdf.annotationStorage,
      enableScripting: false,
      hasJSActions: false,
      fieldObjects: new Map(Object.entries(await this.editor.fieldObjects())),
      imageResourcesPath: '',
    });
    this.hasForms = annotations.some((a) => a.subtype === 'Widget');
  }

  // In the Select tool, pointer events reach the text layer and form fields unless
  // the pointer is over something the user added.
  bindPassthrough() {
    const update = (e) => {
      if (!this.canvas) return;
      const on = this.editor.tool !== 'select' || this.overlayWants(e);
      this.host.classList.toggle('passthrough', !on);
    };
    this.el.addEventListener('pointermove', update, true);
    this.el.addEventListener('pointerdown', (e) => {
      update(e);
      if (this.host.classList.contains('passthrough') && this.canvas?.getActiveObject()) {
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
      }
    }, true);
  }

  overlayWants(e) {
    const c = this.canvas;
    if (c._currentTransform || c.getActiveObject()?.isEditing) return true;
    const r = this.el.getBoundingClientRect();
    const p = new fabric.Point((e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale);
    const pad = 12 / this.scale;
    const active = c.getActiveObject();
    if (active) {
      const b = active.getBoundingRect();
      if (p.x > b.left - pad && p.x < b.left + b.width + pad && p.y > b.top - pad - 30 / this.scale && p.y < b.top + b.height + pad) return true;
    }
    return c.getObjects().some((o) => o.evented !== false && o.visible !== false && o.containsPoint(p));
  }

  // ---- Fabric overlay lifecycle -------------------------------------------

  get active() { return !!this.canvas; }

  async activate() {
    if (this.canvas) return;
    const el = document.createElement('canvas');
    this.host.appendChild(el);
    const s = this.scale;
    const c = new fabric.Canvas(el, {
      width: Math.round(this.W * s),
      height: Math.round(this.H * s),
      preserveObjectStacking: true,
      stopContextMenu: true,
      selectionColor: 'rgba(47,111,237,0.08)',
      selectionBorderColor: '#2f6fed',
      targetFindTolerance: 4,
    });
    c.setViewportTransform([s, 0, 0, s, 0, 0]);
    c.pageView = this;
    this.canvas = c;
    this.editor.bindCanvas(this);
    await this.loadObjects(this.model.json);
    if (this.editor.night) this.loadContentInfo().then(() => this.drawNight());
  }

  deactivate() {
    if (!this.canvas) return;
    const c = this.canvas;
    if (c.getActiveObject()?.isEditing) return; // never drop an in-progress edit
    this.model.json = this.serialize();
    this.canvas = null;
    this.loadToken++;
    c.dispose();
    this.host.innerHTML = '';
    this.hideHover();
  }

  serialize() {
    if (!this.canvas) return this.model.json;
    return this.canvas.getObjects().map((o) => o.toObject());
  }

  async loadObjects(json) {
    if (!this.canvas) return;
    const token = ++this.loadToken;
    const objects = json && json.length ? await fabric.util.enlivenObjects(json) : [];
    if (objects.length) await this.editor.prepareFonts(objects);
    if (!this.canvas || token !== this.loadToken) return;
    this.canvas.discardActiveObject();
    this.canvas.remove(...this.canvas.getObjects());
    for (const o of objects) {
      prepareObject(o);
      this.canvas.add(o);
    }
    this.editor.applyToolTo(this);
    this.canvas.requestRenderAll();
  }

  // ---- Existing PDF content (Edit tool, night mode) -------------------------

  async loadContentInfo() {
    if (this.infoPromise) return this.infoPromise;
    this.infoPromise = (async () => {
      const [tc, ops] = await Promise.all([this.pdfPage.getTextContent(), this.pdfPage.getOperatorList()]);
      this.runs = buildRuns(tc, this.vpT, this.pdfPage);
      this.paragraphs = buildParagraphs(this.runs);
      this.images = findImages(ops, this.vpT, this.W, this.H);
    })();
    return this.infoPromise;
  }

  isCovered(key) {
    return !!this.canvas?.getObjects().some((o) => o.meta?.src === key || o.meta?.covers?.includes(key));
  }

  hitTest(x, y) {
    if (!this.runs) return null;
    for (const r of this.runs) {
      if (x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.top && y <= r.top + r.h && !this.isCovered(r.key)) {
        const para = this.paragraphs.find((p) => p.runs.includes(r));
        return { type: 'text', item: r, para: para && para.runs.length > 1 && !para.runs.some((x2) => this.isCovered(x2.key)) ? para : null };
      }
    }
    // Smallest image under the cursor wins (images can be nested).
    let best = null;
    for (const im of this.images) {
      if (x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h && !this.isCovered(im.key)) {
        if (!best || im.w * im.h < best.w * best.h) best = im;
      }
    }
    return best ? { type: 'image', item: best } : null;
  }

  showHover(hit, lineOnly) {
    const s = this.scale;
    let b;
    if (hit.type === 'text') {
      const t = hit.para && !lineOnly ? hit.para : hit.item;
      b = { x: t.x - 1, y: t.top, w: t.w + 2, h: t.h };
    } else b = hit.item;
    Object.assign(this.hover.style, {
      left: `${b.x * s}px`, top: `${b.y * s}px`, width: `${b.w * s}px`, height: `${b.h * s}px`,
    });
    this.hover.className = `hover-box ${hit.type}`;
    this.hover.hidden = false;
  }

  hideHover() { this.hover.hidden = true; }

  // ---- Night mode: re-invert photos so only paper and text flip ---------------

  drawNight() {
    this.nightLayer.innerHTML = '';
    if (!this.editor.night || !this.images) return;
    const s = this.scale;
    for (const im of this.images) {
      const d = document.createElement('div');
      Object.assign(d.style, { left: `${im.x * s}px`, top: `${im.y * s}px`, width: `${im.w * s}px`, height: `${im.h * s}px` });
      this.nightLayer.appendChild(d);
    }
  }

  // ---- Search highlights -------------------------------------------------------

  setSearchHits(hits, activeIdx) {
    this.searchHits = hits;
    this.searchActive = activeIdx;
    this.drawSearch();
  }

  drawSearch() {
    this.searchEl.innerHTML = '';
    if (!this.searchHits?.length) return;
    const s = this.scale;
    this.searchHits.forEach((h, i) => {
      const d = document.createElement('div');
      d.className = i === this.searchActive ? 'hit active' : 'hit';
      Object.assign(d.style, { left: `${h.x * s}px`, top: `${h.y * s}px`, width: `${h.w * s}px`, height: `${h.h * s}px` });
      this.searchEl.appendChild(d);
    });
  }

  // ---- Pixel helpers -------------------------------------------------------------

  // Reads pixels of the rendered page for a box given in page units.
  sampleBox(x, y, w, h) {
    const k = this.pdfCanvas.width / this.W;
    if (!k) return null;
    const px = Math.max(0, Math.floor(x * k));
    const py = Math.max(0, Math.floor(y * k));
    const pw = Math.min(this.pdfCanvas.width - px, Math.ceil(w * k));
    const ph = Math.min(this.pdfCanvas.height - py, Math.ceil(h * k));
    if (pw <= 0 || ph <= 0) return null;
    const data = this.pdfCanvas.getContext('2d').getImageData(px, py, pw, ph).data;
    // Unpainted areas are transparent; treat them as the white paper they show as.
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 1) for (let j = 0; j < 3; j++) data[i + j] = Math.round(data[i + j] * a + 255 * (1 - a));
    }
    return data;
  }

  // Background = most common colour in the box; foreground = the pixel furthest from it.
  sampleColors(x, y, w, h) {
    const data = this.sampleBox(x, y, w, h);
    if (!data) return { bg: '#ffffff', fg: '#000000' };
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bgKey = 0, max = -1;
    for (const [k, n] of counts) if (n > max) { max = n; bgKey = k; }
    const br = ((bgKey >> 10) & 31) * 8 + 4, bgG = ((bgKey >> 5) & 31) * 8 + 4, bb = (bgKey & 31) * 8 + 4;
    let fg = [0, 0, 0], far = -1;
    for (let i = 0; i < data.length; i += 4) {
      const d = (data[i] - br) ** 2 + (data[i + 1] - bgG) ** 2 + (data[i + 2] - bb) ** 2;
      if (d > far) { far = d; fg = [data[i], data[i + 1], data[i + 2]]; }
    }
    const snap = (v) => (v > 247 ? 255 : v < 8 ? 0 : v);
    return { bg: hex([snap(br), snap(bgG), snap(bb)]), fg: hex(fg.map(snap)) };
  }

  // Renders a region of the page at high resolution, returning a PNG data URL.
  async cropRegion(box, quality = 3) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(box.w * quality));
    c.height = Math.max(1, Math.round(box.h * quality));
    await this.pdfPage.render({
      canvasContext: c.getContext('2d'),
      viewport: this.viewport(quality),
      transform: [1, 0, 0, 1, -box.x * quality, -box.y * quality],
      background: 'rgba(0,0,0,0)',
    }).promise;
    return c.toDataURL('image/png');
  }
}

export function prepareObject(o) {
  const kind = o.meta?.kind;
  if (kind === 'cover') o.set({ selectable: false, evented: false, hoverCursor: 'default' });
  if (kind === 'text') o.set({ lockScalingFlip: true });
  if (kind === 'markup') o.set({ hasControls: false, lockMovementX: true, lockMovementY: true, hoverCursor: 'pointer' });
  if (kind === 'note') o.set({ hasControls: false, hoverCursor: 'pointer' });
}

function hex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

// Turn pdf.js text items into editable runs: items on one baseline are joined into a line,
// and lines with big gaps are split into separate runs (e.g. table columns).
function buildRuns(tc, vpT, pdfPage) {
  const items = [];
  for (const item of tc.items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const t = mul(vpT, item.transform);
    const fs = Math.hypot(t[2], t[3]);
    if (fs < 1 || Math.abs(Math.atan2(t[1], t[0])) > 0.02) continue;
    items.push({ x: t[4], base: t[5], w: item.width, fs, str: item.str, fontName: item.fontName, rtl: item.dir === 'rtl' || hasArabic(item.str) });
  }
  // Group into lines by baseline.
  items.sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.base - it.base) < it.fs * 0.3 && Math.abs(l.fs - it.fs) < it.fs * 0.2);
    if (line) line.items.push(it); else lines.push({ base: it.base, fs: it.fs, items: [it] });
  }
  const runs = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let seg = null;
    const flush = () => { if (seg) runs.push(seg); seg = null; };
    for (const it of line.items) {
      if (seg && it.x - (seg.x + seg.w) < it.fs * 0.9) {
        seg.parts.push(it);
        seg.w = Math.max(seg.w, it.x + it.w - seg.x);
      } else {
        flush();
        seg = { x: it.x, base: it.base, w: it.w, fs: it.fs, parts: [it], fontName: it.fontName };
      }
    }
    flush();
  }
  return runs.map((r, i) => {
    const rtl = r.parts.filter((p) => p.rtl).length > r.parts.length / 2;
    const ordered = rtl ? [...r.parts].reverse() : r.parts;
    let str = '';
    ordered.forEach((p, j) => {
      if (j) {
        const prev = ordered[j - 1];
        const gap = rtl ? prev.x - (p.x + p.w) : p.x - (prev.x + prev.w);
        if (gap > p.fs * 0.15 && !str.endsWith(' ') && !p.str.startsWith(' ')) str += ' ';
      }
      str += p.str;
    });
    return {
      key: `t${i}`,
      x: r.x, base: r.base, w: r.w, fs: r.fs,
      top: r.base - r.fs * 0.86,
      h: r.fs * 1.1,
      str: str.replace(/\s+$/, ''),
      rtl,
      font: guessFont(tc.styles[r.fontName], r.fontName, pdfPage, rtl),
    };
  });
}

// Group consecutive lines with the same size and alignment into paragraphs.
function buildParagraphs(runs) {
  const sorted = [...runs].sort((a, b) => a.base - b.base);
  const paras = [];
  for (const r of sorted) {
    const p = paras.find((q) => {
      const last = q.runs[q.runs.length - 1];
      const gap = r.base - last.base;
      const sameSize = Math.abs(r.fs - q.fs) < q.fs * 0.12;
      const aligned = r.rtl
        ? Math.abs((r.x + r.w) - (last.x + last.w)) < r.fs * 1.5
        : Math.abs(r.x - last.x) < r.fs * 1.5;
      const overlaps = r.x < q.x + q.w && r.x + r.w > q.x;
      return sameSize && aligned && overlaps && gap > r.fs * 0.9 && gap < r.fs * 2.1 && r.font.font === q.font.font && r.rtl === q.rtl;
    });
    if (p) {
      p.runs.push(r);
      p.x = Math.min(p.x, r.x);
      p.w = Math.max(p.x + p.w, r.x + r.w) - p.x;
    } else paras.push({ runs: [r], x: r.x, w: r.w, fs: r.fs, font: r.font, rtl: r.rtl });
  }
  return paras.map((p, i) => {
    const first = p.runs[0], last = p.runs[p.runs.length - 1];
    const gaps = p.runs.slice(1).map((r, j) => r.base - p.runs[j].base);
    let text = '';
    for (const r of p.runs) {
      if (!text) text = r.str;
      else if (/[A-Za-z]-$/.test(text)) text = text.slice(0, -1) + r.str;
      else text += ` ${r.str}`;
    }
    return {
      key: `p${i}`, runs: p.runs, x: p.x, w: p.w, fs: p.fs, font: p.font, rtl: p.rtl,
      top: first.top, h: last.base + last.fs * 0.24 - first.top,
      base: first.base,
      lineGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : first.fs * 1.2,
      str: text,
    };
  });
}

function guessFont(style, fontName, pdfPage, rtl) {
  let name = '';
  let obj = null;
  try {
    if (pdfPage.commonObjs.has(fontName)) {
      obj = pdfPage.commonObjs.get(fontName);
      name = [obj?.name, obj?.loadedName, obj?.fallbackName, obj?.systemFontInfo?.baseFontName].filter(Boolean).join(' ');
    }
  } catch { /* font not loaded */ }
  const n = name.toLowerCase();
  const family = style?.fontFamily || '';
  let font = 'Helvetica';
  if (/courier|mono|consol/.test(n) || family === 'monospace') font = 'Courier';
  else if (family === 'serif' || /times|georgia|garamond|roman|cambria|minion|palatino|naskh|(?<!sans-)serif/.test(n)) font = 'Times';
  if (rtl) font = font === 'Times' ? 'Naskh' : 'ArSans';
  return {
    font,
    bold: !!(obj?.bold || obj?.black) || /bold|black|heavy|semibold|demi/.test(n),
    italic: !!obj?.italic || /italic|oblique/.test(n),
    pdfName: obj?.name || '', // real font name, e.g. "ABCDEF+Calibri-Bold"
    obj, // pdf.js font object (keeps the embedded program bytes)
  };
}

// Walk the operator list tracking the transform to find where images are drawn.
function findImages(ops, vpT, W, H) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, Array.from(args));
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args?.[0] && args[0].length === 6) ctm = mul(ctm, Array.from(args[0]));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const m = mul(vpT, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(m, x, y));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
      const w = Math.min(W, Math.max(...xs)) - x, h = Math.min(H, Math.max(...ys)) - y;
      if (w < 6 || h < 6 || w * h > W * H * 0.9) continue;
      out.push({ key: `i${out.length}`, x, y, w, h });
    }
  }
  return out;
}
