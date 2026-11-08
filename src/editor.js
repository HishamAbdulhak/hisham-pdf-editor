// Editor: one open document — its page views, tools, undo history and page operations.
// Tool choice and style settings are shared between tabs (see `shared`).
import * as pdfjsLib from 'pdfjs-dist';
import * as fabric from 'fabric';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { PageView, BASELINE, prepareObject } from './page.js';
import { FONTS, fontCss, isRtlText, hasArabic } from './fonts.js';
import { isNamed, familyOf, namedId, matchPdfFont, registerEmbedded, embeddedCovers, embeddedReady, embeddedFont, prepareDisplay, familyAvailable, offerDownload, genericFor } from './fontlib.js';
import { toast, askToast } from './ui.js';
import { t } from './i18n.js';
import { assetUrl, pdfjsOptions } from './assets.js';
import { applyFormValues } from './exporter.js';
import { pruneUnused } from './prune.js';

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.min.mjs');
  workerReady = true;
}

export function loadPdfjs(bytes, password) {
  ensureWorker();
  return pdfjsLib.getDocument({ data: bytes.slice(), password, ...pdfjsOptions() }).promise;
}

const DRAG_TOOLS = new Set(['rect', 'ellipse', 'line', 'arrow', 'whiteout', 'redact']);
const HISTORY_LIMIT = 100;
// Page operations keep a full copy of the PDF for undo; only this many stay undoable.
const DOC_UNDO_LIMIT = 10;
let nextId = 1;
export const newId = (p = 'p') => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const STAMPS = {
  Approved: '#067647', Draft: '#475467', Confidential: '#b42318', Paid: '#067647',
  Rejected: '#b42318', Received: '#1d3fbf', Reviewed: '#1d3fbf', Final: '#7a5af8',
};

export class Editor {
  constructor({ scroller, pagesEl, shared, onChange }) {
    this.scroller = scroller;
    this.pagesEl = pagesEl;
    this.shared = shared; // { tool, props, night }
    this.onChange = onChange;
    this.scale = 1;
    this.fitMode = true;
    this.views = [];
    this.models = [];
    this.bytes = null;
    this.pdf = null;
    this.fileName = null;
    this.filePath = null; // file it was opened from
    this.savePath = null; // where Ctrl+S writes quietly (set after the first save)
    this.password = null; // password used to open it, if any
    this.protect = null; // { userPassword } to encrypt on save
    this.undoStack = [];
    this.redoStack = [];
    this.savedMarker = undefined;
    this.formDirty = false;
    this.focusView = null;
    this.currentPage = 0;
    this.linkService = makeLinkService(this);
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: scroller, rootMargin: '600px 0px',
    });
    this.visible = new Set();
    scroller.addEventListener('scroll', () => this.updateCurrentPage(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => {
      if (this.fitMode && this.views.length && this.scroller.clientWidth) this.fitWidth();
    }));
    this.resizeObserver.observe(scroller);
  }

  get tool() { return this.shared.tool; }
  get props() { return this.shared.props; }
  get night() { return this.shared.night; }
  get hasDoc() { return !!this.pdf; }
  get dirty() { return this.formDirty || this.undoStack[this.undoStack.length - 1] !== this.savedMarker; }

  // ---- Loading ---------------------------------------------------------------

  // Throws {code:'password'} when a password is needed (or was wrong).
  async open({ data, name, path, password, models, bytesAreWorking }) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const header = new TextDecoder().decode(bytes.slice(0, 1024));
    if (!header.includes('%PDF')) throw new Error(t('This file is not a PDF.'));
    let pdf;
    try {
      pdf = await loadPdfjs(bytes, password);
    } catch (e) {
      if (e?.name === 'PasswordException') {
        const err = new Error(e.code === 2 ? t('Wrong password.') : t('This PDF needs a password.'));
        err.code = 'password';
        err.wrong = e.code === 2;
        throw err;
      }
      throw new Error(t('This PDF is damaged or cannot be read.'));
    }
    let working = bytes;
    if (password != null && !bytesAreWorking) {
      // Keep an unlocked copy to edit; it is locked again on save if the user wants.
      const doc = await PDFDocument.load(bytes, { password, updateMetadata: false });
      working = await doc.save();
      this.protect = { userPassword: password };
      destroyPdf(pdf);
      pdf = await loadPdfjs(working);
    }
    this.password = password ?? null;
    this.fileName = name || 'document.pdf';
    this.filePath = path || null;
    this.undoStack = [];
    this.redoStack = [];
    this.savedMarker = undefined;
    this.formDirty = false;
    const pageModels = models || Array.from({ length: pdf.numPages }, () => ({ id: newId(), json: [] }));
    await this.setDocument(working, pageModels, pdf);
    this.fitMode = true;
    this.fitWidth();
    this.scroller.scrollTop = 0;
    this.onChange('doc');
  }

  async setDocument(bytes, models, pdf = null) {
    const keepScroll = this.scroller.scrollTop;
    for (const v of this.views) { v.deactivate(); v.release(); this.observer.unobserve(v.el); }
    if (this.pdf && this.pdf !== pdf) destroyPdf(this.pdf);
    this.bytes = bytes;
    this.pdf = pdf || await loadPdfjs(bytes);
    this.pdf.annotationStorage.onSetModified = () => { this.formDirty = true; this.onChange('history'); };
    this.fields = null;
    this.outline = undefined;
    this.models = models;
    this.pagesEl.innerHTML = '';
    this.visible.clear();
    this.focusView = null;
    this.views = models.map((m, i) => new PageView(this, m, i));
    await Promise.all(this.views.map((v) => v.init(this.pdf)));
    const frag = document.createDocumentFragment();
    for (const v of this.views) frag.appendChild(v.el);
    this.pagesEl.appendChild(frag);
    for (const v of this.views) this.observer.observe(v.el);
    this.scroller.scrollTop = keepScroll;
    this.updateCurrentPage();
  }

  destroy() {
    for (const v of this.views) { v.deactivate(); v.release(); }
    this.observer.disconnect();
    this.resizeObserver.disconnect();
    if (this.pdf) destroyPdf(this.pdf);
    this.pdf = null;
    this.views = [];
  }

  // Form fields by name: [{ id, type, exportValues }], built from the pages' widget annotations.
  fieldObjects() {
    if (!this.fields) {
      this.fields = (async () => {
        const map = {};
        for (const v of this.views) {
          for (const a of await v.pdfPage.getAnnotations()) {
            if (a.subtype !== 'Widget' || !a.fieldName) continue;
            const type = a.fieldType === 'Tx' ? 'text'
              : a.fieldType === 'Btn' ? (a.radioButton ? 'radiobutton' : a.checkBox ? 'checkbox' : 'button')
                : a.fieldType === 'Ch' ? (a.combo ? 'combobox' : 'listbox') : 'other';
            (map[a.fieldName] ||= []).push({ id: a.id, type, exportValues: a.buttonValue ?? a.exportValue, page: v.index });
          }
        }
        return map;
      })();
    }
    return this.fields;
  }

  async getOutline() {
    if (this.outline === undefined) this.outline = (await this.pdf.getOutline()) || [];
    return this.outline;
  }

  async destToPage(dest) {
    try {
      const explicit = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest;
      if (!explicit) return null;
      const ref = explicit[0];
      return typeof ref === 'number' ? ref : await this.pdf.getPageIndex(ref);
    } catch { return null; }
  }

  onIntersect(entries) {
    for (const e of entries) {
      const v = this.views.find((x) => x.el === e.target);
      if (!v) continue;
      if (e.isIntersecting) {
        this.visible.add(v);
        this.showView(v);
      } else {
        this.visible.delete(v);
        if (v !== this.focusView) { v.deactivate(); v.release(); }
      }
    }
  }

  async showView(v) {
    await v.render();
    if (!this.visible.has(v) && v !== this.focusView) return;
    await v.activate();
  }

  // ---- Zoom & navigation -------------------------------------------------------

  setScale(scale, { fit = false } = {}) {
    scale = Math.min(5, Math.max(0.25, scale));
    if (!this.views.length) { this.scale = scale; return; }
    const center = (this.scroller.scrollTop + this.scroller.clientHeight / 2) / (this.scroller.scrollHeight || 1);
    this.fitMode = fit;
    this.scale = scale;
    for (const v of this.views) v.layout();
    this.scroller.scrollTop = center * this.scroller.scrollHeight - this.scroller.clientHeight / 2;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => { for (const v of this.visible) this.showView(v); }, 120);
    this.onChange('zoom');
  }

  fitWidth() {
    if (!this.views.length) return;
    const maxW = Math.max(...this.views.map((v) => v.W));
    const avail = this.scroller.clientWidth - 64;
    if (avail <= 0) return;
    this.setScale(Math.max(0.25, Math.min(2.5, avail / maxW)), { fit: true });
  }

  zoomBy(f) { this.setScale(this.scale * f); }

  updateCurrentPage() {
    const mid = this.scroller.getBoundingClientRect().top + this.scroller.clientHeight * 0.35;
    let cur = 0;
    for (const v of this.views) {
      const r = v.el.getBoundingClientRect();
      if (r.top <= mid) cur = v.index; else break;
    }
    if (cur !== this.currentPage) {
      this.currentPage = cur;
      this.onChange('page');
    }
  }

  scrollToPage(i, y = null) {
    const v = this.views[i];
    if (!v) return;
    const top = v.el.offsetTop - 16 + (y != null ? Math.max(0, y * this.scale - 80) : 0);
    this.scroller.scrollTo({ top, behavior: 'smooth' });
  }

  setNight(on) {
    this.pagesEl.classList.toggle('night', on);
    for (const v of this.views) {
      if (on && v.canvas) v.loadContentInfo().then(() => v.drawNight());
      else v.drawNight();
    }
  }

  // ---- Tools -------------------------------------------------------------------

  applyTool() {
    for (const v of this.views) {
      if (!v.canvas) continue;
      if (this.tool !== 'select' && this.tool !== 'edit') v.canvas.discardActiveObject();
      this.applyToolTo(v);
      v.canvas.requestRenderAll();
    }
  }

  applyToolTo(view) {
    const c = view.canvas;
    if (!c) return;
    const tool = this.tool;
    const p = this.props;
    c.isDrawingMode = tool === 'pen' || tool === 'highlight';
    if (c.isDrawingMode) {
      const brush = new fabric.PencilBrush(c);
      brush.color = tool === 'pen' ? p.color : withAlpha(p.highlight, 0.4);
      brush.width = tool === 'pen' ? p.width : p.hlWidth;
      brush.decimate = 1.5;
      brush.strokeLineCap = tool === 'pen' ? 'round' : 'square';
      c.freeDrawingBrush = brush;
    }
    const interactive = tool === 'select' || tool === 'edit' || tool === 'eraser';
    c.selection = tool === 'select';
    c.skipTargetFind = !interactive;
    c.defaultCursor = tool === 'select' ? 'default' : tool === 'eraser' ? 'not-allowed' : tool === 'edit' ? 'text' : tool === 'note' ? 'copy' : 'crosshair';
    c.hoverCursor = tool === 'eraser' ? 'pointer' : 'move';
    view.host.classList.toggle('passthrough', tool === 'select');
    view.hideHover();
    if (tool === 'edit') view.loadContentInfo().catch((e) => console.error(e));
  }

  bindCanvas(view) {
    const c = view.canvas;
    c.on('mouse:down', (o) => this.onDown(view, o));
    c.on('mouse:move', (o) => this.onMove(view, o));
    c.on('mouse:up', (o) => this.onUp(view, o));
    c.on('mouse:dblclick', (o) => { if (o.target?.meta?.kind === 'note') this.onChange('note', { view, obj: o.target }); });
    c.on('mouse:out', () => view.hideHover());
    c.on('object:modified', () => this.commit(view));
    c.on('path:created', ({ path }) => {
      const hl = this.tool === 'highlight';
      path.set({
        meta: { kind: hl ? 'highlight' : 'pen' },
        strokeLineJoin: 'round',
        ...(hl ? { stroke: this.props.highlight, opacity: 0.4, globalCompositeOperation: 'multiply' } : {}),
      });
      c.requestRenderAll();
      this.commit(view);
    });
    c.on('text:changed', ({ target }) => {
      const rtl = isRtlText(target.text);
      if ((target.direction === 'rtl') !== rtl) target.set('direction', rtl ? 'rtl' : 'ltr');
    });
    c.on('text:editing:exited', ({ target }) => {
      if (!target.text.trim()) c.remove(target);
      this.commit(view);
    });
    const sel = () => {
      if (c.getActiveObject()) {
        this.focusView = view;
        for (const v of this.views) if (v !== view && v.canvas) { v.canvas.discardActiveObject(); v.canvas.requestRenderAll(); }
      }
      this.onChange('selection');
    };
    c.on('selection:created', sel);
    c.on('selection:updated', sel);
    c.on('selection:cleared', sel);
  }

  onDown(view, o) {
    this.focusView = view;
    const c = view.canvas;
    const pt = c.getScenePoint(o.e);
    const tool = this.tool;
    if (tool === 'select' && o.target?.meta?.kind === 'note' && o.e.detail === 1) {
      this.onChange('note', { view, obj: o.target });
      return;
    }
    if (tool === 'eraser') {
      this.erasing = true;
      if (o.target) this.eraseObject(view, o.target);
      return;
    }
    if (tool === 'edit') {
      if (o.target) return;
      const hit = view.hitTest(pt.x, pt.y);
      if (hit?.type === 'text') this.editText(view, hit, o.e);
      else if (hit?.type === 'image') this.extractImage(view, hit.item);
      return;
    }
    if (tool === 'text') {
      const tb = this.makeTextbox('', { left: pt.x, top: pt.y - this.props.size * 0.5 });
      c.add(tb);
      c.setActiveObject(tb);
      this.onChange('setTool', 'select');
      tb.enterEditing();
      return;
    }
    if (tool === 'note') {
      const note = this.makeNote(pt);
      c.add(note);
      this.onChange('setTool', 'select');
      c.setActiveObject(note);
      this.commit(view);
      this.onChange('note', { view, obj: note, isNew: true });
      return;
    }
    if (DRAG_TOOLS.has(tool)) {
      this.drag = { view, start: pt, obj: this.makeShape(tool, pt, pt) };
      c.add(this.drag.obj);
    }
  }

  onMove(view, o) {
    const c = view.canvas;
    if (this.tool === 'eraser') {
      if (this.erasing && o.target) this.eraseObject(view, o.target);
      return;
    }
    if (this.tool === 'edit') {
      if (o.target) { view.hideHover(); return; }
      const pt = c.getScenePoint(o.e);
      const hit = view.hitTest(pt.x, pt.y);
      if (hit) view.showHover(hit, o.e.altKey); else view.hideHover();
      return;
    }
    if (this.drag && this.drag.view === view) {
      const pt = c.getScenePoint(o.e);
      this.updateShape(this.drag.obj, this.tool, this.drag.start, pt, o.e.shiftKey);
      c.requestRenderAll();
    }
  }

  onUp(view, o) {
    if (this.erasing) {
      this.erasing = false;
      if (this.erasedSomething) { this.erasedSomething = false; this.commit(view); }
      return;
    }
    if (!this.drag || this.drag.view !== view) return;
    const c = view.canvas;
    const { start, obj } = this.drag;
    const tool = this.tool;
    this.drag = null;
    let end = c.getScenePoint(o.e);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) {
      end = tool === 'line' || tool === 'arrow'
        ? { x: start.x + 120, y: start.y }
        : { x: start.x + (tool === 'whiteout' || tool === 'redact' ? 140 : 120), y: start.y + (tool === 'whiteout' || tool === 'redact' ? 24 : 80) };
      this.updateShape(obj, tool, start, end, false);
    }
    let final = obj;
    if (tool === 'arrow') {
      c.remove(obj);
      final = this.makeArrow(start, { x: obj.x2, y: obj.y2 });
      c.add(final);
    }
    final.setCoords();
    if (tool !== 'redact') this.onChange('setTool', 'select');
    c.setActiveObject(final);
    c.requestRenderAll();
    this.commit(view);
  }

  eraseObject(view, target) {
    if (target.meta?.kind === 'cover') return;
    view.canvas.remove(target);
    this.erasedSomething = true;
  }

  makeTextbox(text, opts) {
    const p = this.props;
    const rtl = isRtlText(text);
    return new fabric.Textbox(text, {
      originX: 'left',
      originY: 'top',
      width: 220,
      fontSize: p.size,
      fontFamily: fontCss({ font: p.font, generic: p.generic }),
      fontWeight: p.bold ? 'bold' : 'normal',
      fontStyle: p.italic ? 'italic' : 'normal',
      textAlign: p.align,
      direction: rtl ? 'rtl' : 'ltr',
      fill: p.color,
      opacity: p.opacity,
      lineHeight: 1.16,
      editingBorderColor: '#2f6fed',
      cursorColor: '#2f6fed',
      meta: isNamed(p.font) ? { kind: 'text', font: p.font, generic: p.generic || genericFor(familyOf(p.font)) } : { kind: 'text', font: p.font },
      ...opts,
    });
  }

  makeShape(tool, a, b) {
    const p = this.props;
    const common = { originX: 'left', originY: 'top', opacity: p.opacity, strokeUniform: false };
    if (tool === 'rect' || tool === 'whiteout' || tool === 'redact') {
      if (tool === 'redact') {
        return new fabric.Rect({
          ...common, left: a.x, top: a.y, width: 1, height: 1, opacity: 1,
          fill: 'rgba(0,0,0,0.35)', stroke: '#d92d20', strokeWidth: 1.5, strokeDashArray: [5, 3], strokeUniform: true,
          meta: { kind: 'redact' },
        });
      }
      const isW = tool === 'whiteout';
      return new fabric.Rect({
        ...common,
        left: a.x, top: a.y, width: 1, height: 1,
        fill: isW ? '#ffffff' : (p.fill || 'transparent'),
        stroke: isW ? null : p.color,
        strokeWidth: isW ? 0 : p.width,
        opacity: isW ? 1 : p.opacity,
        meta: { kind: isW ? 'whiteout' : 'rect' },
      });
    }
    if (tool === 'ellipse') {
      return new fabric.Ellipse({
        ...common, left: a.x, top: a.y, rx: 1, ry: 1,
        fill: p.fill || 'transparent', stroke: p.color, strokeWidth: p.width, meta: { kind: 'ellipse' },
      });
    }
    return new fabric.Line([a.x, a.y, b.x, b.y], {
      stroke: p.color, strokeWidth: p.width, strokeLineCap: 'round', opacity: p.opacity,
      meta: { kind: 'line' },
    });
  }

  updateShape(obj, tool, a, b, constrain) {
    let dx = b.x - a.x, dy = b.y - a.y;
    if (tool === 'line' || tool === 'arrow') {
      if (constrain) {
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        dx = Math.cos(ang) * len; dy = Math.sin(ang) * len;
      }
      obj.set({ x1: a.x, y1: a.y, x2: a.x + dx, y2: a.y + dy });
      obj.setCoords();
      return;
    }
    if (constrain) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    const left = Math.min(a.x, a.x + dx), top = Math.min(a.y, a.y + dy);
    const w = Math.max(1, Math.abs(dx)), h = Math.max(1, Math.abs(dy));
    if (tool === 'ellipse') obj.set({ left, top, rx: w / 2, ry: h / 2 });
    else obj.set({ left, top, width: w, height: h });
    obj.setCoords();
  }

  makeArrow(a, b) {
    const p = this.props;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, p.width * 4);
    const h1 = { x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) };
    const h2 = { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) };
    const d = `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${h1.x} ${h1.y} L ${b.x} ${b.y} L ${h2.x} ${h2.y}`;
    return new fabric.Path(d, {
      fill: '', stroke: p.color, strokeWidth: p.width, strokeLineCap: 'round', strokeLineJoin: 'round',
      opacity: p.opacity, meta: { kind: 'arrow' },
    });
  }

  makeNote(pt, text = '') {
    const body = new fabric.Rect({ left: 0, top: 0, width: 22, height: 20, rx: 3, ry: 3, fill: '#ffd43b', stroke: '#c99a00', strokeWidth: 1, originX: 'left', originY: 'top' });
    const lines = [5, 9, 13].map((y) => new fabric.Line([4, y, 18, y], { stroke: '#8a6d00', strokeWidth: 1.2 }));
    const tail = new fabric.Path('M 5 20 L 5 25 L 10 20', { fill: '#ffd43b', stroke: '#c99a00', strokeWidth: 1 });
    return new fabric.Group([body, ...lines, tail], {
      left: pt.x, top: pt.y, originX: 'left', originY: 'top',
      hasControls: false, hoverCursor: 'pointer', subTargetCheck: false,
      meta: { kind: 'note', text, date: new Date().toISOString(), author: '' },
    });
  }

  async addStamp(label, { date = true } = {}) {
    const view = this.targetView();
    if (!view) return;
    await this.showView(view);
    const color = STAMPS[label] || '#b42318';
    const title = new fabric.FabricText(label.toUpperCase(), {
      fontFamily: FONTS.Helvetica, fontWeight: 'bold', fontSize: 22, fill: color, charSpacing: 80,
      originX: 'center', originY: 'top', left: 0, top: 0, meta: { kind: 'text', font: 'Helvetica' },
    });
    const parts = [title];
    if (date) {
      const d = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      parts.push(new fabric.FabricText(d, {
        fontFamily: FONTS.Helvetica, fontSize: 11, fill: color, originX: 'center', originY: 'top', left: 0, top: 28,
        meta: { kind: 'text', font: 'Helvetica' },
      }));
    }
    const w = Math.max(...parts.map((p) => p.width)) + 28;
    const h = date ? 52 : 38;
    const frame = new fabric.Rect({
      width: w, height: h, rx: 6, ry: 6, fill: 'transparent', stroke: color, strokeWidth: 3,
      originX: 'center', originY: 'top', left: 0, top: -8,
    });
    const group = new fabric.Group([frame, ...parts], { angle: -8, meta: { kind: 'stamp', label } });
    this.placeCentered(view, group);
  }

  placeCentered(view, obj) {
    const r = view.el.getBoundingClientRect();
    const sr = this.scroller.getBoundingClientRect();
    const visTop = Math.max(r.top, sr.top), visBot = Math.min(r.bottom, sr.bottom);
    const cy = visBot > visTop ? ((visTop + visBot) / 2 - r.top) / this.scale : view.H / 2;
    obj.set({ originX: 'center', originY: 'center', left: view.W / 2, top: Math.min(view.H - 20, Math.max(20, cy)) });
    this.onChange('setTool', 'select');
    view.canvas.add(obj);
    view.canvas.setActiveObject(obj);
    view.canvas.requestRenderAll();
    this.commit(view);
  }

  // Highlight / underline / strike-through over selected text. rects are in page units.
  addMarkup(view, rects, type, color) {
    if (!view.canvas || !rects.length) return;
    const parts = rects.map((r) => {
      if (type === 'highlight') {
        return new fabric.Rect({ left: r.x, top: r.y, width: r.w, height: r.h, fill: color, opacity: 0.45, globalCompositeOperation: 'multiply', originX: 'left', originY: 'top', meta: { kind: 'hl' } });
      }
      const th = Math.max(0.8, r.h * 0.07);
      const y = type === 'underline' ? r.y + r.h - th * 1.2 : r.y + r.h * 0.55;
      return new fabric.Rect({ left: r.x, top: y, width: r.w, height: th, fill: color, originX: 'left', originY: 'top' });
    });
    const g = new fabric.Group(parts, { meta: { kind: 'markup', type }, subTargetCheck: false });
    prepareObject(g);
    view.canvas.add(g);
    view.canvas.requestRenderAll();
    this.commit(view);
  }

  // ---- Editing existing PDF content ---------------------------------------------

  editText(view, hit, e) {
    const para = hit.para && !e.altKey ? hit.para : null;
    const run = para || hit.item;
    const c = view.canvas;
    const pad = run.fs * 0.06;
    const { bg, fg } = view.sampleColors(run.x - pad, run.top, run.w + pad * 2, run.h);
    const covers = para ? para.runs.map((r) => r.key) : undefined;
    const cover = new fabric.Rect({
      originX: 'left', originY: 'top',
      left: run.x - pad, top: run.top, width: run.w + pad * 2, height: run.h,
      fill: bg, strokeWidth: 0, meta: { kind: 'cover', src: run.key, covers },
    });
    prepareObject(cover);
    const fontSize = Math.round(run.fs * 2) / 2;
    const width = para ? run.w + fontSize * 0.5 : Math.max(run.w * 1.08 + fontSize, 40);
    const rtl = run.rtl;
    const lineHeight = para ? Math.max(1, para.lineGap / (fontSize * 1.13)) : 1.16;
    const tb = this.makeTextbox(run.str, {
      left: rtl ? run.x + run.w - width : run.x,
      top: run.base - fontSize * BASELINE,
      width,
      fontSize,
      lineHeight,
      fontFamily: fontCss({ font: run.font.font }),
      fontWeight: run.font.bold ? 'bold' : 'normal',
      fontStyle: run.font.italic ? 'italic' : 'normal',
      textAlign: rtl ? 'right' : 'left',
      direction: rtl ? 'rtl' : 'ltr',
      fill: fg,
      opacity: 1,
      meta: { kind: 'text', font: run.font.font, src: run.key },
    });
    view.hideHover();
    c.add(cover, tb);
    c.setActiveObject(tb);
    tb.enterEditing(e);
    const idx = tb.getSelectionStartFromPointer(e);
    tb.selectionStart = tb.selectionEnd = idx;
    c.requestRenderAll();
    this.syncPropsFrom(tb);
    if (hasArabic(run.str)) toast(t('Arabic text from the PDF may come out jumbled — retype it if needed.'), 'info', 5000);
    // Switch to the PDF's own font once it is found (the built-in font shows meanwhile).
    return this.useOriginalFont(view, tb, run).catch((err) => console.warn('original font', err));
  }

  // Keeps the original font: the copy embedded in the PDF, the installed font of that name,
  // a bundled look-alike, or (if the user agrees) a downloaded one.
  async useOriginalFont(view, tb, run) {
    const f = run.font;
    if (!f?.pdfName || run.rtl) return null; // Arabic keeps the shaping-aware Arabic fonts
    const m = await matchPdfFont(f.pdfName);
    if (!m) return null;
    // The PDF's copy is usually a partial subset: only worth it when the full font isn't installed.
    let embedded = null;
    const k = !m.installed && f.obj ? registerEmbedded(f.obj) : null;
    if (k && embeddedCovers(k, run.str)) { embedded = k; await embeddedReady(k); }
    const available = await familyAvailable(m.family);
    if (!available && !embedded) return null; // nothing better than the built-in font
    const apply = async () => {
      await prepareDisplay(m.family);
      const meta = { ...tb.meta, font: namedId(m.family), generic: f.font };
      if (embedded) meta.embedded = embedded; else delete meta.embedded;
      tb.meta = meta;
      tb.set('fontFamily', fontCss(meta));
      tb.initDimensions();
      tb.setCoords();
      tb.dirty = true;
      view.canvas?.requestRenderAll();
      if (view.canvas?.getActiveObject() === tb) this.syncPropsFrom(tb);
      if (!tb.isEditing && view.canvas?.getObjects().includes(tb)) this.commit(view);
    };
    await apply();
    if (!available) {
      // Only the PDF's partial copy exists: offer to fetch the full font for new letters.
      offerDownload(m.family, (family) => askToast(
        t('“{f}” isn’t installed. Download it from Google Fonts so new letters match?', { f: family }),
        [{ label: t('Download'), value: 'yes', primary: true }, { label: t('Always'), value: 'always' }, { label: t('Not now'), value: 'no' }, { label: t('Never ask'), value: 'never' }],
      )).then(async (r) => {
        if (!r) return;
        if (r.ok) {
          toast(t('Font “{f}” downloaded.', { f: m.family }), 'success');
          if (tb.meta?.font === namedId(m.family)) await apply(); // unless a different font was picked meanwhile
        }
        else toast(t('Couldn’t get “{f}” — keeping the closest match.', { f: m.family }), 'warn', 4500);
      });
    }
    return { family: m.family, embedded, installed: m.installed, lookalike: m.lookalike };
  }

  // Makes sure named fonts used by loaded objects are drawable (after undo, reload or recovery).
  async prepareFonts(objects) {
    const fams = new Set(objects.filter((o) => o.meta?.kind === 'text' && isNamed(o.meta.font)).map((o) => familyOf(o.meta.font)));
    if (!fams.size) return false;
    await Promise.all([...fams].map((fam) => prepareDisplay(fam).catch(() => {})));
    for (const o of objects) {
      if (o.meta?.kind !== 'text' || !isNamed(o.meta.font)) continue;
      o.set('fontFamily', fontCss(o.meta));
      o.initDimensions?.();
      o.dirty = true;
    }
    return true;
  }

  async extractImage(view, im) {
    const c = view.canvas;
    view.hideHover();
    const ring = 2;
    const { bg } = view.sampleColors(im.x - ring, im.y - ring, im.w + ring * 2, ring);
    const url = await view.cropRegion(im);
    const img = await fabric.FabricImage.fromURL(url);
    const cover = new fabric.Rect({
      originX: 'left', originY: 'top',
      left: im.x - 0.5, top: im.y - 0.5, width: im.w + 1, height: im.h + 1,
      fill: bg, strokeWidth: 0, meta: { kind: 'cover', src: im.key },
    });
    prepareObject(cover);
    img.set({
      originX: 'left', originY: 'top', left: im.x, top: im.y,
      scaleX: im.w / img.width, scaleY: im.h / img.height,
      meta: { kind: 'image', src: im.key },
    });
    if (!view.canvas) return;
    c.add(cover, img);
    c.setActiveObject(img);
    c.requestRenderAll();
    this.commit(view);
    toast(t('Image unlocked — drag to move, use the handles to resize, or press Delete to remove it.'), 'info', 4500);
  }

  // ---- Adding things -----------------------------------------------------------

  targetView() {
    return this.focusView && this.focusView.index === this.currentPage
      ? this.focusView
      : this.views[this.currentPage || 0];
  }

  async addImage(dataUrl, { kind = 'image', maxFrac = 0.5 } = {}) {
    const view = this.targetView();
    if (!view) return;
    this.focusView = view;
    await this.showView(view);
    const img = await fabric.FabricImage.fromURL(dataUrl);
    const k = Math.min(1, (view.W * maxFrac) / img.width, (view.H * maxFrac) / img.height);
    img.set({ scaleX: k, scaleY: k, meta: { kind } });
    this.placeCentered(view, img);
  }

  // ---- Selection & properties --------------------------------------------------

  activeView() {
    return this.views.find((v) => v.canvas?.getActiveObject());
  }

  selectedObjects() {
    const v = this.activeView();
    return v ? v.canvas.getActiveObjects() : [];
  }

  syncPropsFrom(o) {
    const p = this.props;
    if (o.meta?.kind === 'text') {
      p.color = o.fill;
      p.size = Math.round(o.fontSize * (o.scaleY || 1) * 10) / 10;
      p.font = o.meta.font || 'Helvetica';
      p.generic = o.meta.generic;
      p.bold = o.fontWeight === 'bold';
      p.italic = o.fontStyle === 'italic';
      p.align = o.textAlign;
    }
    this.onChange('props');
  }

  applyPropToSelection(name, value) {
    const v = this.activeView();
    if (!v) return;
    for (const o of v.canvas.getActiveObjects()) applyProp(o, name, value);
    v.canvas.requestRenderAll();
    this.commit(v);
  }

  deleteSelection() {
    const v = this.activeView();
    if (!v) return false;
    const objs = v.canvas.getActiveObjects();
    if (!objs.length || objs.some((o) => o.isEditing)) return false;
    v.canvas.discardActiveObject();
    v.canvas.remove(...objs);
    v.canvas.requestRenderAll();
    this.commit(v);
    return true;
  }

  copySelection(clipboard) {
    const v = this.activeView();
    const objs = this.selectedObjects();
    if (!v || !objs.length) return false;
    const sel = v.canvas.getActiveObject();
    // Serialise in page coordinates (objects inside a multi-selection are group-relative).
    v.canvas.discardActiveObject();
    clipboard.items = objs.map((o) => o.toObject());
    v.canvas.setActiveObject(objs.length > 1 ? new fabric.ActiveSelection(objs, { canvas: v.canvas }) : sel);
    v.canvas.requestRenderAll();
    return true;
  }

  async paste(clipboard) {
    if (!clipboard.items) return;
    const view = this.targetView();
    await this.showView(view);
    const objs = await fabric.util.enlivenObjects(clipboard.items);
    for (const o of objs) {
      o.set({ left: o.left + 12, top: o.top + 12 });
      if (o.meta?.src) o.meta = { ...o.meta, src: undefined, covers: undefined };
      prepareObject(o);
      view.canvas.add(o);
    }
    clipboard.items = objs.map((o) => o.toObject());
    this.onChange('setTool', 'select');
    view.canvas.setActiveObject(objs.length > 1 ? new fabric.ActiveSelection(objs, { canvas: view.canvas }) : objs[0]);
    view.canvas.requestRenderAll();
    this.commit(view);
  }

  arrange(dir) {
    const v = this.activeView();
    if (!v) return;
    for (const o of v.canvas.getActiveObjects()) {
      if (dir === 'front') v.canvas.bringObjectToFront(o); else v.canvas.sendObjectToBack(o);
    }
    // Cover boxes always stay underneath so moved originals never get hidden.
    for (const o of v.canvas.getObjects().filter((x) => x.meta?.kind === 'cover')) v.canvas.sendObjectToBack(o);
    v.canvas.requestRenderAll();
    this.commit(v);
  }

  hasRedactions() {
    return this.snapshotModels().some((m) => m.json?.some((o) => o.meta?.kind === 'redact'));
  }

  // ---- History -----------------------------------------------------------------

  commit(view) {
    const before = view.model.json;
    const after = view.serialize();
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    view.model.json = after;
    this.pushHistory({ type: 'page', id: view.model.id, before, after });
  }

  pushHistory(entry) {
    const stack = this.undoStack;
    stack.push(entry);
    let drop = Math.max(0, stack.length - HISTORY_LIMIT);
    const docEntries = stack.filter((x) => x.type === 'doc');
    if (docEntries.length > DOC_UNDO_LIMIT) drop = Math.max(drop, stack.indexOf(docEntries[docEntries.length - DOC_UNDO_LIMIT - 1]) + 1);
    for (const dropped of stack.splice(0, drop)) if (dropped === this.savedMarker) this.savedMarker = null;
    this.redoStack = [];
    this.onChange('history');
  }

  async undo() { await this.step(this.undoStack, this.redoStack, 'before'); }
  async redo() { await this.step(this.redoStack, this.undoStack, 'after'); }

  async step(from, to, side) {
    const editing = this.views.find((x) => x.canvas?.getActiveObject()?.isEditing);
    if (editing) editing.canvas.getActiveObject().exitEditing();
    const entry = from.pop();
    if (!entry) return;
    to.push(entry);
    if (entry.type === 'page') {
      const view = this.views.find((x) => x.model.id === entry.id);
      if (view) {
        view.model.json = entry[side];
        await view.loadObjects(entry[side]);
        const r = view.el.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
        if (r.bottom < sr.top || r.top > sr.bottom) this.scrollToPage(view.index);
      }
    } else {
      const snap = entry[side];
      await this.setDocument(snap.bytes, snap.models.map((m) => ({ ...m })));
      this.onChange('doc');
    }
    this.onChange('history');
  }

  markSaved() {
    this.savedMarker = this.undoStack[this.undoStack.length - 1];
    this.formDirty = false;
    this.onChange('history');
  }

  // Serialises every page's current overlay state.
  snapshotModels() {
    for (const v of this.views) if (v.canvas) v.model.json = v.serialize();
    return this.models.map((m) => ({ id: m.id, json: m.json }));
  }

  finishTextEditing() {
    for (const v of this.views) {
      const o = v.canvas?.getActiveObject();
      if (o?.isEditing) o.exitEditing();
    }
  }

  // ---- Page operations (rewrite the underlying PDF with pdf-lib) -------------------

  async loadLib() {
    return PDFDocument.load(this.bytes, { updateMetadata: false });
  }

  async pageOp(fn) {
    this.finishTextEditing();
    // Typed form values go into the "before" copy too, so undo doesn't erase them.
    let base = this.bytes;
    if (this.formDirty) {
      const filled = await this.loadLib();
      await applyFormValues(filled, this);
      base = await filled.save();
    }
    const before = { bytes: base, models: this.snapshotModels() };
    const doc = await PDFDocument.load(base, { updateMetadata: false });
    const models = await fn(doc, before.models.map((m) => ({ ...m })));
    if (!models) return;
    pruneUnused(doc);
    const bytes = await doc.save();
    await this.setDocument(bytes, models);
    this.pushHistory({ type: 'doc', before, after: { bytes, models: models.map((m) => ({ ...m })) } });
    this.onChange('doc');
  }

  rotatePage(i, delta) {
    const v = this.views[i];
    const W = v.W, H = v.H;
    return this.pageOp(async (doc, models) => {
      const page = doc.getPage(i);
      page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
      const fn = delta > 0 ? (x, y) => ({ x: H - y, y: x }) : (x, y) => ({ x: y, y: W - x });
      models[i] = { ...models[i], json: await transformObjects(models[i].json, fn, delta) };
      return models;
    });
  }

  deletePage(i) {
    if (this.views.length <= 1) { toast(t('A PDF needs at least one page.'), 'warn'); return null; }
    return this.pageOp(async (doc, models) => {
      doc.removePage(i);
      models.splice(i, 1);
      return models;
    });
  }

  async insertBlankPage(after) {
    await this.pageOp(async (doc, models) => {
      const src = doc.getPage(Math.max(0, after));
      const { width, height } = src.getSize();
      const page = doc.insertPage(after + 1, [width, height]);
      page.setRotation(src.getRotation());
      models.splice(after + 1, 0, { id: newId(), json: [] });
      return models;
    });
    this.scrollToPage(after + 1);
  }

  movePage(from, to) {
    if (from === to) return null;
    return this.pageOp(async (doc, models) => {
      const page = doc.getPage(from);
      doc.removePage(from);
      doc.insertPage(to, page);
      const [m] = models.splice(from, 1);
      models.splice(to, 0, m);
      return models;
    });
  }

  mergePdf(data, password) {
    return this.pageOp(async (doc, models) => {
      const other = await PDFDocument.load(data, { updateMetadata: false, ...(password != null ? { password } : {}) });
      const pages = await doc.copyPages(other, other.getPageIndices());
      for (const p of pages) { doc.addPage(p); models.push({ id: newId(), json: [] }); }
      return models;
    });
  }
}

function destroyPdf(pdf) {
  try { (pdf.loadingTask || pdf).destroy?.(); } catch { /* already gone */ }
}

function withAlpha(hexColor, a) {
  const n = parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Minimal pdf.js link service: internal links scroll, external links open in the browser.
function makeLinkService(editor) {
  return {
    externalLinkEnabled: true,
    isInPresentationMode: false,
    get pagesCount() { return editor.views.length; },
    get page() { return editor.currentPage + 1; },
    set page(n) { editor.scrollToPage(n - 1); },
    rotation: 0,
    addLinkAttributes(link, url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
    },
    getDestinationHash: () => '#',
    getAnchorUrl: () => '#',
    async goToDestination(dest) {
      const i = await editor.destToPage(dest);
      if (i != null) editor.scrollToPage(i);
    },
    goToPage(n) { editor.scrollToPage(n - 1); },
    setHash() {},
    executeNamedAction(action) {
      const n = { NextPage: editor.currentPage + 1, PrevPage: editor.currentPage - 1, FirstPage: 0, LastPage: editor.views.length - 1 }[action];
      if (n != null) editor.scrollToPage(n);
    },
    executeSetOCGState() {},
    cachePageRef() {},
    isPageVisible: () => true,
    isPageCached: () => true,
  };
}

export function applyProp(o, name, value) {
  const k = o.meta?.kind;
  switch (name) {
    case 'color':
      if (k === 'text') o.set('fill', value);
      else if (['pen', 'line', 'arrow', 'rect', 'ellipse'].includes(k)) o.set('stroke', value);
      else if (k === 'whiteout') o.set('fill', value);
      else if (k === 'markup') o.getObjects().forEach((c) => c.set('fill', value));
      break;
    case 'highlight':
      if (k === 'highlight') o.set('stroke', value);
      break;
    case 'fill':
      if (k === 'rect' || k === 'ellipse') o.set('fill', value || 'transparent');
      break;
    case 'width':
      if (['pen', 'line', 'arrow', 'rect', 'ellipse'].includes(k)) o.set('strokeWidth', value);
      break;
    case 'hlWidth':
      if (k === 'highlight') o.set('strokeWidth', value);
      break;
    case 'opacity':
      if (!['highlight', 'cover', 'redact', 'markup', 'note'].includes(k)) o.set('opacity', value);
      break;
    case 'font':
      if (k === 'text') {
        const same = value === o.meta?.font;
        const meta = { ...o.meta, font: value, generic: isNamed(value) ? (same ? o.meta.generic : genericFor(familyOf(value))) : undefined, embedded: same ? o.meta.embedded : undefined };
        o.meta = meta;
        o.set('fontFamily', fontCss(meta));
      }
      break;
    case 'size':
      if (k === 'text') o.set({ fontSize: value / (o.scaleY || 1) });
      break;
    case 'bold':
      if (k === 'text') { o.set('fontWeight', value ? 'bold' : 'normal'); dropEmbedded(o); }
      break;
    case 'italic':
      if (k === 'text') { o.set('fontStyle', value ? 'italic' : 'normal'); dropEmbedded(o); }
      break;
    case 'align':
      if (k === 'text') o.set('textAlign', value);
      break;
    default:
  }
  if (o.initDimensions && k === 'text') o.initDimensions();
  o.setCoords();
  o.dirty = true;
}

// The PDF's embedded copy is a single style; after bold/italic changes use the full family.
function dropEmbedded(o) {
  const emb = o.meta?.embedded && embeddedFont(o.meta.embedded);
  if (!emb) return;
  if (emb.bold === (o.fontWeight === 'bold') && emb.italic === (o.fontStyle === 'italic')) return;
  o.meta = { ...o.meta, embedded: undefined };
  o.set('fontFamily', fontCss(o.meta));
}

// Rotates overlay objects along with their page (delta = ±90).
async function transformObjects(json, fn, delta) {
  if (!json?.length) return json;
  const objs = await fabric.util.enlivenObjects(json);
  return objs.map((o) => {
    const c = o.getCenterPoint();
    const n = fn(c.x, c.y);
    o.set('angle', ((o.angle || 0) + delta + 360) % 360);
    o.setPositionByOrigin(new fabric.Point(n.x, n.y), 'center', 'center');
    return o.toObject();
  });
}
