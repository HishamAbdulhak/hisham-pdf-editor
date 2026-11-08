// Hisham's PDF Editor — app shell: toolbar, tabs, sidebar, saving, recovery, shortcuts.
import { Tabs } from './tabs.js';
import * as fabric from 'fabric';
import { newId, loadPdfjs } from './editor.js';
import { exportPdf } from './exporter.js';
import { chooseSignature } from './signature.js';
import { platform, fileToDataUrl } from './platform.js';
import { icons, toast, busy, progress, confirmBox, dropdown, modal } from './ui.js';
import { t, setLang, getLang, onLangChange } from './i18n.js';
import { FAMILIES, loadDisplayFonts } from './fonts.js';
import { assetUrl } from './assets.js';
import { Search } from './search.js';
import { printDoc } from './print.js';
import { compressImages } from './compress.js';
import { ocrPages, pagesNeedingOcr, releaseOcr, recognizeCanvas, renderForOcr } from './ocr.js';
import { applyRedactions } from './redact.js';
import {
  addPageNumbers, addWatermark, splitGroups, splitPdf, extractPages, pagesToImages, imagesToPdf, parseRanges,
} from './pagetools.js';
import * as D from './dialogs.js';

const $ = (id) => document.getElementById(id);

// ---- Shared state ------------------------------------------------------------------------

const shared = {
  tool: 'select',
  night: false,
  props: {
    color: '#1f2937', fill: '', width: 2, highlight: '#ffe066', hlWidth: 14,
    font: 'Helvetica', size: 14, bold: false, italic: false, align: 'left', opacity: 1,
  },
};
const clipboard = { items: null };
let settings = {};
let search = null;

const tabs = new Tabs({
  bar: $('tabbar'),
  views: $('views'),
  shared,
  onEditorChange: (tab, what, arg) => onEditorChange(tab, what, arg),
  onActivate: () => { closeFind(); refreshAll(); },
  onCloseClick: (tab) => closeTab(tab),
  onNewClick: () => openDialog(),
});
const ed = () => tabs.active?.editor || null;
window.pdfApp = { tabs, shared }; // handy for debugging from DevTools (more added below)

const TOOLS = [
  ['select', 'Select', 'V', 'Select text, fill forms, and move things you added'],
  ['edit', 'Edit', 'E', 'Edit the PDF’s own text and images (Alt+click: one line)'],
  ['text', 'Text', 'T', 'Add a text box'],
  ['pen', 'Draw', 'P', 'Freehand drawing'],
  ['highlight', 'Marker', 'H', 'Highlighter pen'],
  ['rect', 'Box', 'R', 'Rectangle'],
  ['ellipse', 'Circle', 'O', 'Ellipse / circle'],
  ['line', 'Line', 'L', 'Straight line (hold Shift to snap)'],
  ['arrow', 'Arrow', 'A', 'Arrow'],
  ['note', 'Comment', 'N', 'Sticky-note comment'],
  ['whiteout', 'Whiteout', 'W', 'Cover content with a white box'],
  ['redact', 'Redact', 'K', 'Mark areas to remove permanently'],
  ['eraser', 'Eraser', 'X', 'Remove things you added'],
];

function button({ icon, label, title, onClick, cls = '' }) {
  const b = document.createElement('button');
  b.className = `tb-btn ${cls}`;
  b.innerHTML = `${icons[icon] || ''}${label ? `<span>${label}</span>` : ''}`;
  b.title = title || label || '';
  if (!label && title) b.setAttribute('aria-label', title);
  if (onClick) b.onclick = onClick;
  return b;
}

// ---- Toolbar -------------------------------------------------------------------------------

const toolButtons = {};
let undoBtn, redoBtn, zoomLabel, nightBtn;

function buildToolbar() {
  $('brandName').textContent = t("Hisham's PDF Editor");
  $('fileGroup').replaceChildren(
    button({ icon: 'open', label: t('Open'), title: `${t('Open PDF')} (Ctrl+O)`, onClick: () => openDialog() }),
    button({ icon: 'save', label: t('Save'), title: `${t('Save')} (Ctrl+S)`, onClick: () => saveActive(false), cls: 'needs-doc' }),
  );

  const toolGroup = $('toolGroup');
  toolGroup.innerHTML = '';
  for (const [id, label, key, tip] of TOOLS) {
    const b = button({ icon: id, label: t(label), title: `${t(tip)} (${key})`, onClick: () => setTool(id), cls: 'tool needs-doc' });
    toolButtons[id] = b;
    toolGroup.appendChild(b);
  }

  $('insertGroup').replaceChildren(
    button({ icon: 'image', label: t('Image'), title: `${t('Insert an image')} (I)`, onClick: () => insertImage(), cls: 'needs-doc' }),
    button({ icon: 'sign', label: t('Sign'), title: `${t('Add your signature')} (S)`, onClick: () => sign(), cls: 'needs-doc accent' }),
    button({ icon: 'stamp', label: t('Stamp'), title: t('Add a stamp'), onClick: () => stamp(), cls: 'needs-doc' }),
  );

  undoBtn = button({ icon: 'undo', title: `${t('Undo')} (Ctrl+Z)`, onClick: () => ed()?.undo(), cls: 'needs-doc' });
  redoBtn = button({ icon: 'redo', title: `${t('Redo')} (Ctrl+Y)`, onClick: () => ed()?.redo(), cls: 'needs-doc' });
  $('historyGroup').replaceChildren(undoBtn, redoBtn);

  zoomLabel = document.createElement('button');
  zoomLabel.className = 'zoom-label needs-doc';
  zoomLabel.title = t('Fit width');
  zoomLabel.onclick = () => ed()?.fitWidth();
  nightBtn = button({ icon: 'night', title: t('Night mode (dark pages)'), onClick: () => toggleNight(), cls: 'needs-doc' });
  $('viewGroup').replaceChildren(
    button({ icon: 'find', title: `${t('Find')} (Ctrl+F)`, onClick: () => openFind(), cls: 'needs-doc' }),
    nightBtn,
    button({ icon: 'zoomOut', title: `${t('Zoom out')} (Ctrl+-)`, onClick: () => ed()?.zoomBy(1 / 1.2), cls: 'needs-doc' }),
    zoomLabel,
    button({ icon: 'zoomIn', title: `${t('Zoom in')} (Ctrl+=)`, onClick: () => ed()?.zoomBy(1.2), cls: 'needs-doc' }),
  );

  const toolsBtn = button({ icon: 'tools', label: t('Tools'), title: t('More tools') });
  toolsBtn.onclick = () => dropdown(toolsBtn, toolsMenu());
  const langBtn = button({ icon: 'globe', label: getLang() === 'ar' ? 'English' : 'العربية', title: t('Change language'), onClick: () => changeLang(getLang() === 'ar' ? 'en' : 'ar') });
  $('moreGroup').replaceChildren(toolsBtn, langBtn);

  $('pageGroup').replaceChildren(
    button({ icon: 'rotL', title: t('Rotate page left'), onClick: () => pageAction('rotL'), cls: 'mini needs-doc' }),
    button({ icon: 'rotR', title: t('Rotate page right'), onClick: () => pageAction('rotR'), cls: 'mini needs-doc' }),
    button({ icon: 'plusPage', title: t('Insert blank page after current'), onClick: () => pageAction('insert'), cls: 'mini needs-doc' }),
    button({ icon: 'merge', title: t('Add pages from another PDF'), onClick: () => merge(), cls: 'mini needs-doc' }),
    button({ icon: 'extract', title: t('Save some pages as a new PDF'), onClick: () => extract(), cls: 'mini needs-doc' }),
    button({ icon: 'trash', title: t('Delete current page'), onClick: () => pageAction('delete'), cls: 'mini needs-doc danger' }),
  );

  $('sideTabPages').innerHTML = `${icons.pages}<span>${t('Pages')}</span>`;
  $('sideTabOutline').innerHTML = `${icons.bookmark}<span>${t('Bookmarks')}</span>`;

  $('welcomeTitle').textContent = t('Edit any PDF');
  $('welcomeText').textContent = t('Change text, fill forms, add images, draw, sign, and organise pages. Your files never leave this computer.');
  $('welcomeOpen').textContent = t('Open a PDF');
  $('welcomeImages').textContent = t('Create PDF from images');
  $('welcomeHint').textContent = t('or drag PDF files anywhere onto this window');
  $('dropHint').textContent = t('Drop to open');
  $('findInput').placeholder = t('Find in document');
  $('findPrev').title = t('Previous (Shift+Enter)');
  $('findNext').title = t('Next (Enter)');
  $('findClose').title = t('Close');
  buildSelectionBar();
  tabs.render();
  showRecent();
}

function toolsMenu() {
  const has = !!ed()?.hasDoc;
  return [
    { icon: 'ocr', label: t('Recognize text (OCR)…'), onClick: () => ocr(), disabled: !has },
    { icon: 'compress', label: t('Reduce file size…'), onClick: () => compress(), disabled: !has },
    { icon: 'lock', label: t('Password protection…'), onClick: () => protect(), disabled: !has },
    'sep',
    { icon: 'merge', label: t('Merge PDF…'), onClick: () => merge(), disabled: !has },
    { icon: 'split', label: t('Split PDF…'), onClick: () => split(), disabled: !has },
    { icon: 'extract', label: t('Extract pages…'), onClick: () => extract(), disabled: !has },
    { icon: 'images', label: t('Export pages as images…'), onClick: () => toImages(), disabled: !has },
    { icon: 'images', label: t('Create PDF from images…'), onClick: () => fromImages() },
    'sep',
    { icon: 'numbers', label: t('Page numbers…'), onClick: () => pageNumbers(), disabled: !has },
    { icon: 'watermark', label: t('Watermark…'), onClick: () => watermark(), disabled: !has },
    'sep',
    { icon: 'print', label: `${t('Print…')}  Ctrl+P`, onClick: () => print(), disabled: !has },
    { icon: 'save', label: `${t('Save As…')}  Ctrl+Shift+S`, onClick: () => saveActive(true), disabled: !has },
    'sep',
    ...(platform.isDesktop ? [{ icon: 'file', label: t('Set as default PDF app…'), onClick: () => setDefaultApp() }] : []),
    { icon: 'info', label: t('Keyboard shortcuts'), onClick: () => showShortcuts() },
    { icon: 'info', label: t('About'), onClick: () => showAbout() },
  ];
}

function setTool(tool) {
  shared.tool = tool;
  for (const tab of tabs.list) tab.editor.applyTool();
  if (tool === 'edit') toast(t('Click text to change a whole paragraph (Alt+click for one line), or click an image to move or delete it.'), 'info', 4500);
  if (tool === 'redact') toast(t('Draw boxes over what you want removed, then press “Apply redactions”.'), 'info', 4500);
  renderPropbar();
  updateChrome();
}

// ---- Property bar --------------------------------------------------------------------------

const SWATCHES = ['#1f2937', '#ffffff', '#d92d20', '#f79009', '#12b76a', '#2f6fed', '#7a5af8', '#ee46bc'];
const HL_SWATCHES = ['#ffe066', '#a6f4c5', '#9fd4ff', '#ffb3d9', '#ffc58f'];
const FONT_LABELS = { Helvetica: 'Sans (Helvetica)', Times: 'Serif (Times)', Courier: 'Mono (Courier)', Naskh: 'Arabic Naskh', ArSans: 'Arabic Sans' };

function setProp(name, value) {
  shared.props[name] = value;
  ed()?.applyPropToSelection(name, value);
  if (['color', 'width', 'highlight', 'hlWidth'].includes(name)) for (const tab of tabs.list) tab.editor.applyTool();
  renderPropbar();
}

function renderPropbar() {
  const bar = $('propbar');
  bar.innerHTML = '';
  const e = ed();
  if (!e?.hasDoc) { bar.hidden = true; return; }
  bar.hidden = false;
  const selected = e.selectedObjects();
  const kinds = new Set(selected.map((o) => o.meta?.kind));
  const tool = shared.tool;
  const toolKind = { text: 'text', pen: 'pen', highlight: 'highlight', rect: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'arrow', whiteout: 'whiteout', redact: 'redact' }[tool];
  if (toolKind) kinds.add(toolKind);
  const p = shared.props;
  const has = (...k) => k.some((x) => kinds.has(x));

  const section = (label) => {
    const s = document.createElement('div');
    s.className = 'prop';
    if (label) s.innerHTML = `<span class="prop-label">${label}</span>`;
    bar.appendChild(s);
    return s;
  };
  const swatches = (s, list, current, onPick, allowNone = false) => {
    if (allowNone) {
      const n = document.createElement('button');
      n.className = `swatch none${!current ? ' on' : ''}`;
      n.title = t('No fill');
      n.onclick = () => onPick('');
      s.appendChild(n);
    }
    for (const c of list) {
      const b = document.createElement('button');
      b.className = `swatch${String(current).toLowerCase() === c ? ' on' : ''}`;
      b.style.background = c;
      b.title = c;
      b.onclick = () => onPick(c);
      s.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'color-input';
    custom.title = t('Custom colour');
    custom.value = /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#000000';
    custom.onchange = () => onPick(custom.value);
    s.appendChild(custom);
  };
  const range = (s, min, max, step, value, onChange, fmt = (v) => v) => {
    const r = document.createElement('input');
    r.type = 'range';
    Object.assign(r, { min, max, step, value });
    const out = document.createElement('span');
    out.className = 'prop-val';
    out.textContent = fmt(value);
    r.oninput = () => { out.textContent = fmt(+r.value); };
    r.onchange = () => onChange(+r.value);
    s.append(r, out);
  };
  const toggle = (s, icon, on, title, onClick) => s.appendChild(button({ icon, title, onClick, cls: `mini${on ? ' on' : ''}` }));

  let shown = false;
  if (has('redact')) {
    const s = section('');
    s.classList.add('redact-info');
    const n = e.snapshotModels().reduce((k, m) => k + (m.json?.filter((o) => o.meta?.kind === 'redact').length || 0), 0);
    s.append(Object.assign(document.createElement('span'), { className: 'prop-hint', textContent: n ? t('{n} area(s) marked for redaction.', { n }) : t('Drag over anything you want permanently removed.') }));
    if (n) s.appendChild(button({ icon: 'redact', label: t('Apply redactions'), title: t('Permanently remove marked areas'), onClick: () => redactNow(), cls: 'mini danger-solid' }));
    shown = true;
  }
  if (has('text', 'pen', 'line', 'arrow', 'rect', 'ellipse', 'whiteout', 'markup')) {
    const label = has('text') ? t('Text colour') : has('whiteout') && !has('pen', 'line', 'arrow', 'rect', 'ellipse') ? t('Box colour') : t('Colour');
    const current = has('whiteout') && kinds.size === 1 ? (selected[0]?.fill || '#ffffff') : p.color;
    swatches(section(label), has('markup') && kinds.size === 1 ? [...HL_SWATCHES, '#d92d20', '#2f6fed'] : SWATCHES, current, (c) => setProp('color', c));
    shown = true;
  }
  if (has('highlight')) {
    swatches(section(t('Marker')), HL_SWATCHES, p.highlight, (c) => setProp('highlight', c));
    range(section(t('Size')), 4, 40, 1, p.hlWidth, (v) => setProp('hlWidth', v));
    shown = true;
  }
  if (has('rect', 'ellipse')) swatches(section(t('Fill')), SWATCHES, p.fill, (c) => setProp('fill', c), true);
  if (has('pen', 'line', 'arrow', 'rect', 'ellipse')) range(section(t('Thickness')), 0.5, 20, 0.5, p.width, (v) => setProp('width', v));
  if (has('text')) {
    const s = section(t('Font'));
    const sel = document.createElement('select');
    for (const f of FAMILIES) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = t(FONT_LABELS[f]);
      o.selected = p.font === f;
      sel.appendChild(o);
    }
    sel.onchange = () => setProp('font', sel.value);
    const size = document.createElement('input');
    Object.assign(size, { type: 'number', min: 4, max: 200, step: 0.5, value: p.size, className: 'num', title: t('Font size') });
    size.onchange = () => { if (+size.value > 0) setProp('size', +size.value); };
    s.append(sel, size);
    toggle(s, 'bold', p.bold, t('Bold'), () => setProp('bold', !p.bold));
    toggle(s, 'italic', p.italic, t('Italic'), () => setProp('italic', !p.italic));
    toggle(s, 'alignL', p.align === 'left', t('Align left'), () => setProp('align', 'left'));
    toggle(s, 'alignC', p.align === 'center', t('Align centre'), () => setProp('align', 'center'));
    toggle(s, 'alignR', p.align === 'right', t('Align right'), () => setProp('align', 'right'));
    shown = true;
  }
  if (selected.length && !has('highlight', 'whiteout', 'redact', 'markup', 'note')) {
    range(section(t('Opacity')), 0.1, 1, 0.05, selected[0]?.opacity ?? 1, (v) => setProp('opacity', v), (v) => `${Math.round(v * 100)}%`);
  }
  if (selected.length) {
    const s = section('');
    s.classList.add('actions');
    if (kinds.has('note') && selected.length === 1) {
      s.appendChild(button({ icon: 'note', label: t('Edit comment'), onClick: () => editNote(e.activeView(), selected[0]), cls: 'mini' }));
    }
    s.append(
      button({ icon: 'copy', label: t('Duplicate'), title: `${t('Duplicate')} (Ctrl+D)`, onClick: () => duplicate(), cls: 'mini' }),
      button({ icon: 'front', label: t('Front'), title: t('Bring to front'), onClick: () => e.arrange('front'), cls: 'mini' }),
      button({ icon: 'front', label: t('Back'), title: t('Send to back'), onClick: () => e.arrange('back'), cls: 'mini flip' }),
      button({ icon: 'trash', label: t('Delete'), title: `${t('Delete')} (Del)`, onClick: () => e.deleteSelection(), cls: 'mini danger' }),
    );
    shown = true;
  }
  if (!shown) {
    const hints = {
      select: t('Select and copy text, fill in form fields, or click something you added to move it. Select text to highlight it.'),
      edit: t('Click text to change a whole paragraph (Alt+click for one line), or click an image to move or delete it.'),
      eraser: t('Click or drag over drawings, text boxes or images you added to remove them.'),
      note: t('Click on the page to add a comment.'),
    };
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'prop-hint', textContent: hints[tool] || '' }));
  }
}

// ---- Sidebar: thumbnails and bookmarks ------------------------------------------------------

let thumbObserver = null;
let sideMode = 'pages';
$('sideTabPages').onclick = () => { sideMode = 'pages'; renderSidebar(); };
$('sideTabOutline').onclick = () => { sideMode = 'outline'; renderSidebar(); };

function renderSidebar() {
  $('sideTabPages').classList.toggle('on', sideMode === 'pages');
  $('sideTabOutline').classList.toggle('on', sideMode === 'outline');
  $('thumbs').hidden = sideMode !== 'pages';
  $('pageGroup').hidden = sideMode !== 'pages';
  $('outline').hidden = sideMode !== 'outline';
  if (sideMode === 'pages') renderThumbs(); else renderOutline();
}

function renderThumbs() {
  const wrap = $('thumbs');
  wrap.innerHTML = '';
  thumbObserver?.disconnect();
  const e = ed();
  if (!e?.hasDoc) return;
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting || en.target.dataset.done) continue;
      en.target.dataset.done = '1';
      drawThumb(e, en.target, +en.target.dataset.index);
    }
  }, { root: wrap, rootMargin: '300px 0px' });
  e.views.forEach((v, i) => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.index = i;
    el.draggable = true;
    el.innerHTML = `<div class="thumb-img" style="aspect-ratio:${v.W / v.H}"><canvas></canvas></div><div class="thumb-num">${i + 1}</div>`;
    el.onclick = () => e.scrollToPage(i);
    el.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-page', String(i)); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes('text/x-page')) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      el.classList.toggle('drop-before', ev.clientY < r.top + r.height / 2);
      el.classList.toggle('drop-after', ev.clientY >= r.top + r.height / 2);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (ev) => {
      const from = ev.dataTransfer.getData('text/x-page');
      el.classList.remove('drop-before', 'drop-after');
      if (from === '') return;
      ev.preventDefault();
      ev.stopPropagation();
      const r = el.getBoundingClientRect();
      let to = i + (ev.clientY >= r.top + r.height / 2 ? 1 : 0);
      if (+from < to) to--;
      run(t('Moving page…'), () => e.movePage(+from, to));
    });
    wrap.appendChild(el);
    thumbObserver.observe(el);
  });
  highlightThumb();
}

async function drawThumb(e, el, i) {
  const v = e.views[i];
  if (!v) return;
  const canvas = el.querySelector('canvas');
  const vp = v.viewport((150 * (window.devicePixelRatio || 1)) / v.W);
  canvas.width = vp.width;
  canvas.height = vp.height;
  try { await v.pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise; } catch { /* doc replaced */ }
}

function highlightThumb() {
  const cur = ed()?.currentPage || 0;
  document.querySelectorAll('.thumb').forEach((el) => {
    const on = +el.dataset.index === cur;
    if (on && !el.classList.contains('on')) el.scrollIntoView({ block: 'nearest' });
    el.classList.toggle('on', on);
  });
}

async function renderOutline() {
  const wrap = $('outline');
  wrap.innerHTML = '';
  const e = ed();
  if (!e?.hasDoc) return;
  const items = await e.getOutline();
  if (!items.length) {
    wrap.appendChild(Object.assign(document.createElement('p'), { className: 'empty', textContent: t('This PDF has no bookmarks.') }));
    return;
  }
  const build = (list, depth) => {
    const ul = document.createElement('ul');
    for (const it of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'outline-item';
      b.style.paddingInlineStart = `${8 + depth * 14}px`;
      b.textContent = it.title;
      b.onclick = async () => {
        if (it.dest) { const p = await e.destToPage(it.dest); if (p != null) e.scrollToPage(p); } else if (it.url) window.open(it.url, '_blank');
      };
      li.appendChild(b);
      if (it.items?.length) li.appendChild(build(it.items, depth + 1));
      ul.appendChild(li);
    }
    return ul;
  };
  wrap.appendChild(build(items, 0));
}

// ---- State updates ----------------------------------------------------------------------------

function onEditorChange(tab, what, arg) {
  if (what === 'setTool') { setTool(arg); return; }
  if (what === 'note') { editNote(arg.view, arg.obj, arg.isNew); return; }
  if (what === 'history' || what === 'doc') scheduleRecovery(tab);
  if (tab !== tabs.active) { if (what === 'history') tabs.render(); return; }
  if (what === 'doc') { renderSidebar(); search = null; }
  if (what === 'page') highlightThumb();
  if (['doc', 'selection', 'props', 'history'].includes(what)) renderPropbar();
  if (['doc', 'history'].includes(what)) { updateTitle(); tabs.render(); }
  updateChrome();
}

function refreshAll() {
  renderSidebar();
  renderPropbar();
  updateTitle();
  updateChrome();
}

function updateChrome() {
  const e = ed();
  const hasDoc = !!e?.hasDoc;
  document.body.classList.toggle('has-doc', hasDoc);
  $('welcome').hidden = tabs.list.length > 0;
  document.querySelectorAll('.needs-doc').forEach((b) => { b.disabled = !hasDoc; });
  for (const [id, b] of Object.entries(toolButtons)) b.classList.toggle('on', shared.tool === id);
  if (!undoBtn) return;
  undoBtn.disabled = !hasDoc || !e.undoStack.length;
  redoBtn.disabled = !hasDoc || !e.redoStack.length;
  nightBtn.classList.toggle('on', shared.night);
  zoomLabel.textContent = hasDoc ? `${Math.round(e.scale * 100)}%` : '–';
  $('views').dataset.tool = shared.tool;
  updateStatus();
}

function updateTitle() {
  const dirty = tabs.list.filter((x) => x.editor.hasDoc && x.editor.dirty).length;
  platform.setDirty(dirty);
  const e = ed();
  const name = t("Hisham's PDF Editor");
  platform.setTitle(e?.hasDoc ? `${e.dirty ? '• ' : ''}${e.fileName} — ${name}` : name);
}

function updateStatus() {
  const s = $('status');
  const e = ed();
  s.innerHTML = '';
  if (!e?.hasDoc) { s.textContent = t('Open a PDF to start editing'); return; }
  const file = Object.assign(document.createElement('span'), { textContent: `${e.fileName}${e.dirty ? ` — ${t('unsaved changes')}` : ''}` });
  const parts = [file];
  if (e.protect) parts.push(Object.assign(document.createElement('span'), { className: 'status-lock', innerHTML: `${icons.lock}${t('Password protected')}` }));
  parts.push(Object.assign(document.createElement('span'), { textContent: t('Page {i} of {n}', { i: (e.currentPage || 0) + 1, n: e.views.length }) }));
  parts.push(Object.assign(document.createElement('span'), { textContent: `${Math.round(e.scale * 100)}%` }));
  s.append(...parts);
}

// ---- Running long actions -----------------------------------------------------------------------

async function run(label, fn) {
  busy(true, label);
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    toast(err?.message || String(err), 'error', 6000);
    return undefined;
  } finally {
    busy(false);
  }
}

// ---- Opening, saving, closing ----------------------------------------------------------------------

const recoveryKeyFor = (file) => (file.path ? file.path : `${file.name}|${file.data?.length ?? 0}`);

async function openDialog() {
  const files = await platform.openDialog();
  for (const f of files) await openFile(f);
}

async function openFile(file, opts = {}) {
  if (!file) return null;
  const existing = tabs.findByPath(file.path);
  if (existing) { tabs.activate(existing); return existing; }
  const key = opts.key || recoveryKeyFor(file);
  const sameFile = tabs.list.find((x) => x.recoveryKey === key);
  if (sameFile) { tabs.activate(sameFile); return sameFile; }
  let restore = null;
  const rec = await platform.recoveryGet(key);
  if (rec?.meta?.dirty) {
    if (opts.fromSession) restore = rec;
    else {
      const when = new Date(rec.meta.time || Date.now()).toLocaleString();
      const ok = await confirmBox({
        title: t('Restore unsaved edits?'),
        message: t('“{name}” has unsaved edits from {when}. Restore them?', { name: file.name, when }),
        okLabel: t('Restore edits'),
      });
      if (ok) restore = rec; else await platform.recoveryRemove(key);
    }
  }
  const tab = tabs.add();
  tabs.activate(tab);
  const opened = await run(t('Opening…'), async () => {
    let password;
    let wrong = false;
    for (;;) {
      try {
        await tab.editor.open({
          data: restore?.bytes || file.data,
          name: file.name,
          path: file.path,
          password,
          models: restore?.meta?.models,
          bytesAreWorking: !!restore?.bytes,
        });
        return true;
      } catch (err) {
        if (err.code !== 'password') throw err;
        busy(false);
        password = await D.askPassword(file.name, wrong || err.wrong);
        busy(true, t('Opening…'));
        wrong = true;
        if (password == null) return false;
      }
    }
  });
  if (!opened) { tabs.remove(tab); saveSession(); refreshAll(); return null; }
  tab.recoveryKey = key;
  tab.editor.savePath = restore?.meta?.savePath ?? null;
  if (restore) {
    tab.editor.savedMarker = { restored: true }; // keeps the tab marked unsaved until saved
    tab.lastRecBytes = tab.editor.bytes;
    tab.editor.onChange('history');
    if (opts.fromSession) toast(t('Restored unsaved edits in “{name}”.', { name: file.name }), 'success');
  } else if (!platform.isDesktop && !tab.editor.protect) {
    // Browser: keep a copy so the tab can come back after a restart.
    platform.recoveryPut(key, { name: file.name, dirty: false, models: tab.editor.models, time: Date.now() }, tab.editor.bytes);
    tab.lastRecBytes = tab.editor.bytes;
  }
  if (shared.night) tab.editor.setNight(true);
  refreshAll();
  saveSession();
  return tab;
}

const recoveryTimers = new WeakMap();
function scheduleRecovery(tab) {
  clearTimeout(recoveryTimers.get(tab));
  recoveryTimers.set(tab, setTimeout(() => writeRecovery(tab), 1500));
}

async function writeRecovery(tab) {
  const e = tab.editor;
  if (!e.hasDoc || !tab.recoveryKey || e.protect) return; // never store unlocked copies of protected files
  if (!e.dirty && platform.isDesktop) { await platform.recoveryRemove(tab.recoveryKey); tab.lastRecBytes = null; return; }
  const meta = { name: e.fileName, path: e.filePath, savePath: e.savePath, dirty: e.dirty, models: e.snapshotModels(), time: Date.now() };
  const bytes = tab.lastRecBytes === e.bytes ? null : e.bytes;
  await platform.recoveryPut(tab.recoveryKey, meta, bytes);
  tab.lastRecBytes = e.bytes;
}

function saveSession() {
  const list = tabs.list.filter((x) => x.editor.hasDoc).map((x) => ({ path: x.editor.filePath, key: x.recoveryKey, name: x.editor.fileName }));
  platform.storeSet('session', { tabs: list, active: tabs.list.indexOf(tabs.active) });
}

async function restoreSession() {
  const session = await platform.storeGet('session', null);
  if (!session?.tabs?.length) return;
  for (const entry of session.tabs) {
    try {
      if (entry.path && await platform.fileExists(entry.path)) {
        await openFile(await platform.readPdf(entry.path), { fromSession: true, key: entry.key });
      } else if (entry.key) {
        const rec = await platform.recoveryGet(entry.key);
        if (rec?.bytes) await openFile({ path: null, name: entry.name, data: rec.bytes }, { fromSession: true, key: entry.key });
      }
    } catch (err) { console.warn('session restore', entry, err); }
  }
  const active = tabs.list[session.active];
  if (active) tabs.activate(active);
}

async function saveTab(tab, saveAs = false) {
  const e = tab.editor;
  if (!e.hasDoc) return false;
  e.finishTextEditing();
  if (e.hasRedactions()) {
    const ok = await confirmBox({
      title: t('Apply redactions?'),
      message: t('Marked areas must be applied before saving. Their content will be permanently removed.'),
      okLabel: t('Apply and save'),
      danger: true,
    });
    if (!ok) return false;
    if (!(await redactNow(tab, true))) return false;
  }
  return !!(await run(t('Saving…'), async () => {
    const data = await exportPdf(e);
    const quiet = !saveAs && e.savePath;
    const res = await platform.savePdf({ data, filePath: quiet ? e.savePath : null, defaultPath: e.savePath || e.filePath || e.fileName });
    if (!res) return false;
    const oldKey = tab.recoveryKey;
    if (res.path) { e.savePath = res.path; e.filePath = res.path; }
    e.fileName = res.name;
    e.markSaved();
    if (platform.isDesktop) {
      await platform.recoveryRemove(oldKey);
      tab.recoveryKey = recoveryKeyFor({ path: e.filePath, name: e.fileName });
    } else {
      await writeRecovery(tab);
    }
    toast(t('Saved {name}', { name: res.name }), 'success');
    tabs.render();
    updateTitle();
    updateStatus();
    saveSession();
    return true;
  }));
}

const saveActive = (saveAs) => (tabs.active ? saveTab(tabs.active, saveAs) : null);

async function closeTab(tab) {
  if (tab.editor.hasDoc && tab.editor.dirty) {
    tabs.activate(tab);
    const choice = await D.closeDialog([tab.editor.fileName]);
    if (!choice) return false;
    if (choice === 'save' && !(await saveTab(tab))) return false;
    if (choice === 'discard') await platform.recoveryRemove(tab.recoveryKey);
  }
  if (!platform.isDesktop && tab.recoveryKey) platform.recoveryRemove(tab.recoveryKey);
  tabs.remove(tab);
  saveSession();
  refreshAll();
  return true;
}

async function requestAppClose() {
  const dirtyTabs = tabs.list.filter((x) => x.editor.hasDoc && x.editor.dirty);
  if (!dirtyTabs.length) { platform.closeNow(); return; }
  const choice = await D.closeDialog(dirtyTabs.map((x) => x.editor.fileName));
  if (!choice) return;
  if (choice === 'save') {
    for (const tab of dirtyTabs) {
      tabs.activate(tab);
      if (!(await saveTab(tab))) return;
    }
  } else {
    for (const tab of dirtyTabs) await platform.recoveryRemove(tab.recoveryKey);
  }
  await releaseOcr();
  platform.closeNow();
}

// ---- Insert things -----------------------------------------------------------------------------

async function insertImage() {
  if (!ed()?.hasDoc) return;
  const [img] = await platform.pickImages(false);
  if (img) await run(t('Adding image…'), () => ed().addImage(img.dataUrl, { kind: 'image' }));
}

async function sign() {
  if (!ed()?.hasDoc) return;
  const url = await chooseSignature();
  if (url) {
    await run(t('Adding signature…'), () => ed().addImage(url, { kind: 'sig', maxFrac: 0.3 }));
    toast(t('Drag the signature into place and resize it with the corner handles.'), 'info');
  }
}

async function stamp() {
  if (!ed()?.hasDoc) return;
  const choice = await D.stampPicker();
  if (choice) await ed().addStamp(t(choice.label), { date: choice.date });
}

async function editNote(view, obj, isNew = false) {
  if (!view?.canvas || !obj) return;
  const c = view.canvas;
  obj.setCoords();
  const b = obj.getBoundingRect();
  const pr = view.el.getBoundingClientRect();
  const s = view.scale;
  const rect = { left: pr.left + b.left * s, top: pr.top + b.top * s, right: pr.left + (b.left + b.width) * s };
  let deleted = false;
  const text = await D.noteEditor(rect, obj.meta?.text || '', { onDelete: () => { deleted = true; } });
  if (!view.canvas) return;
  if (deleted || (isNew && !text?.trim())) {
    c.remove(obj);
  } else if (text != null && text !== obj.meta?.text) {
    obj.meta = { ...obj.meta, text, date: new Date().toISOString() };
  }
  c.requestRenderAll();
  view.editor.commit(view);
  renderPropbar();
}

function duplicate() {
  const e = ed();
  if (e?.copySelection(clipboard)) e.paste(clipboard);
}

// ---- Page and document tools ------------------------------------------------------------------------

async function pageAction(kind) {
  const e = ed();
  if (!e?.hasDoc) return null;
  const i = e.currentPage || 0;
  if (kind === 'rotL') return run(t('Rotating…'), () => e.rotatePage(i, -90));
  if (kind === 'rotR') return run(t('Rotating…'), () => e.rotatePage(i, 90));
  if (kind === 'insert') return run(t('Adding page…'), () => e.insertBlankPage(i));
  if (kind === 'delete') {
    const ok = await confirmBox({ title: t('Delete page'), message: t('Delete page {n}? You can undo this with Ctrl+Z.', { n: i + 1 }), okLabel: t('Delete page'), danger: true });
    if (ok) return run(t('Deleting page…'), () => e.deletePage(i));
  }
  return null;
}

async function merge() {
  const e = ed();
  if (!e?.hasDoc) return;
  const f = await platform.pickPdf();
  if (!f) return;
  const before = e.views.length;
  await run(t('Adding pages…'), async () => {
    try {
      await e.mergePdf(f.data);
    } catch (err) {
      if (!/encrypt|password/i.test(String(err?.message))) throw err;
      busy(false);
      const pw = await D.askPassword(f.name, false);
      busy(true, t('Adding pages…'));
      if (pw == null) return;
      await e.mergePdf(f.data, pw);
    }
    toast(t('Added {n} page(s) from {name}', { n: e.views.length - before, name: f.name }), 'success');
    e.scrollToPage(before);
  });
}

async function split() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.splitDialog(e.views.length);
  if (!opts) return;
  await run(t('Splitting…'), async () => {
    const groups = splitGroups(opts.mode, opts.n, opts.ranges, e.views.length);
    const files = await splitPdf(e, groups);
    const res = await platform.saveFiles({ files, baseName: e.fileName.replace(/\.pdf$/i, '') });
    if (res) toast(t('Created {n} PDF files.', { n: files.length }), 'success');
  });
}

async function extract() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.extractDialog(e.views.length, e.currentPage || 0);
  if (!opts) return;
  await run(t('Extracting…'), async () => {
    const file = await extractPages(e, parseRanges(opts.range, e.views.length));
    const res = await platform.savePdf({ data: file.data, defaultPath: file.name });
    if (res) toast(t('Saved {name}', { name: res.name }), 'success');
  });
}

async function toImages() {
  const e = ed();
  if (!e?.hasDoc) return;
  const n = e.views.length;
  const opts = await D.toImagesDialog(n, e.currentPage || 0);
  if (!opts) return;
  const indices = opts.which === 'current' ? [e.currentPage || 0] : opts.which === 'all' ? [...Array(n).keys()] : parseRanges(opts.range, n);
  await run(t('Exporting images…'), async () => {
    const files = await pagesToImages(e, indices, { format: opts.format, dpi: +opts.dpi }, (f) => progress(f));
    if (files.length === 1 && !platform.isDesktop) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([files[0].data]));
      a.download = files[0].name;
      a.click();
      return;
    }
    const res = await platform.saveFiles({ files, baseName: `${e.fileName.replace(/\.pdf$/i, '')} images` });
    if (res) toast(t('Exported {n} image(s).', { n: files.length }), 'success');
  });
}

async function fromImages() {
  const images = await platform.pickImages(true);
  if (!images.length) return;
  const opts = await D.imagesToPdfDialog(images.length);
  if (!opts) return;
  await run(t('Creating PDF…'), async () => {
    const data = await imagesToPdf(images, { size: opts.size, margin: +opts.margin });
    const name = `${images[0].name.replace(/\.[^.]+$/, '')}.pdf`;
    const tab = await openFile({ path: null, name, data }, { key: newId('new') });
    if (tab) { tab.editor.savedMarker = { created: true }; tab.editor.onChange('history'); }
  });
}

async function pageNumbers() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.numbersDialog();
  if (opts) await run(t('Adding page numbers…'), () => addPageNumbers(e, opts));
}

async function watermark() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.watermarkDialog();
  if (!opts) return;
  let imageUrl = null;
  if (opts.kind === 'image') {
    const [img] = await platform.pickImages(false);
    if (!img) return;
    imageUrl = img.dataUrl;
  }
  await run(t('Adding watermark…'), () => addWatermark(e, {
    text: opts.kind === 'text' ? opts.text : null,
    imageUrl,
    size: opts.kind === 'text' ? opts.size : opts.scale,
    angle: opts.angle,
    opacity: opts.opacity / 100,
    color: opts.color,
    pages: opts.pages,
  }));
}

async function compress() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.compressDialog();
  if (!opts) return;
  await run(t('Reducing file size…'), async () => {
    const before = (await exportPdf(e, { encrypt: false })).length;
    let count = 0;
    await e.pageOp(async (doc, models) => { count = await compressImages(doc, opts.level, (f) => progress(f)); return models; });
    const after = (await exportPdf(e, { encrypt: false })).length;
    const mb = (b) => `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`;
    toast(count
      ? t('Reduced from {a} to {b}. Save to keep it.', { a: mb(before), b: mb(after) })
      : t('No pictures could be made smaller — this PDF is already compact.'), count ? 'success' : 'info', 6000);
  });
}

async function protect() {
  const e = ed();
  if (!e?.hasDoc) return;
  const opts = await D.protectDialog(!!e.protect);
  if (!opts) return;
  e.protect = opts.mode === 'remove' ? null : { userPassword: opts.pw };
  if (e.protect) await platform.recoveryRemove(tabs.active.recoveryKey);
  e.savedMarker = { protectChanged: true };
  e.onChange('history');
  tabs.render();
  toast(e.protect ? t('Password set. It will be applied when you save.') : t('Password removed. Save to keep the change.'), 'success');
}

async function ocr() {
  const e = ed();
  if (!e?.hasDoc) return;
  const suggested = (await run(t('Checking pages…'), () => pagesNeedingOcr(e))) || [];
  const opts = await D.ocrDialog({ total: e.views.length, suggested });
  if (!opts) return;
  const n = e.views.length;
  const indices = opts.which === 'scanned' ? suggested : opts.which === 'current' ? [e.currentPage || 0] : opts.which === 'all' ? [...Array(n).keys()] : parseRanges(opts.range, n);
  await run(t('Recognising text…'), async () => {
    await ocrPages(e, indices, opts.langs.split('+'), (f, page) => progress(f, t('Recognising text… page {p}', { p: page + 1 })));
    toast(t('Text recognised on {n} page(s). You can now search and select it.', { n: indices.length }), 'success', 5000);
  });
}

async function redactNow(tab = tabs.active, skipConfirm = false) {
  const e = tab?.editor;
  if (!e?.hasDoc || !e.hasRedactions()) return true;
  if (!skipConfirm) {
    const ok = await confirmBox({
      title: t('Apply redactions'),
      message: t('Pages with marked areas will be turned into images with the areas blacked out, then their text is recognised again. This cannot be undone after saving.'),
      okLabel: t('Apply redactions'),
      danger: true,
    });
    if (!ok) return false;
  }
  const done = await run(t('Applying redactions…'), async () => {
    const n = await applyRedactions(e, { ocr: true }, (f, page) => progress(f, t('Redacting page {p}…', { p: page + 1 })));
    toast(t('Redacted {n} page(s).', { n }), 'success');
    return true;
  });
  setTool('select');
  return !!done;
}

async function print() {
  const e = ed();
  if (!e?.hasDoc) return;
  await run(t('Preparing to print…'), () => printDoc(e, (f) => progress(f)));
}

function toggleNight() {
  shared.night = !shared.night;
  for (const tab of tabs.list) tab.editor.setNight(shared.night);
  settings.night = shared.night;
  platform.storeSet('settings', settings);
  updateChrome();
}

async function setDefaultApp() {
  await modal({
    title: t('Set as default PDF app'),
    build(body, close) {
      body.innerHTML = '<ol class="steps"></ol><div class="modal-actions"><button class="btn" data-cancel></button><button class="btn primary" data-ok></button></div>';
      const steps = [
        t('Windows Settings will open on “Default apps”.'),
        t('Search for “.pdf” at the top.'),
        t('Click the current app and choose “Hisham’s PDF Editor”.'),
      ];
      for (const s of steps) body.querySelector('ol').appendChild(Object.assign(document.createElement('li'), { textContent: s }));
      body.querySelector('[data-cancel]').textContent = t('Cancel');
      body.querySelector('[data-ok]').textContent = t('Open Settings');
      body.querySelector('[data-cancel]').onclick = () => close();
      body.querySelector('[data-ok]').onclick = () => { platform.openDefaultApps(); close(); };
    },
  });
}

function showShortcuts() {
  modal({
    title: t('Keyboard shortcuts'),
    width: 560,
    build(body) {
      const rows = [
        ['Ctrl+O / Ctrl+S / Ctrl+Shift+S', t('Open / Save / Save As')],
        ['Ctrl+W / Ctrl+Tab', t('Close tab / Next tab')],
        ['Ctrl+F, Enter', t('Find, next match')],
        ['Ctrl+P', t('Print')],
        ['Ctrl+Z / Ctrl+Y', t('Undo / Redo')],
        ['Ctrl+C / Ctrl+V / Ctrl+D', t('Copy / Paste / Duplicate')],
        ['Delete', t('Delete selected')],
        [t('Arrow keys (+Shift)'), t('Nudge selected')],
        [t('Ctrl + mouse wheel'), t('Zoom')],
        ...TOOLS.map(([, label, key]) => [key, t('{tool} tool', { tool: t(label) })]),
        ['I / S', t('Insert image / Signature')],
        ['Esc', t('Deselect, back to Select tool')],
      ];
      const table = document.createElement('table');
      table.className = 'keys';
      for (const [k, d] of rows) {
        const tr = table.insertRow();
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        tr.insertCell().appendChild(kbd);
        tr.insertCell().textContent = d;
      }
      body.appendChild(table);
    },
  });
}

async function showAbout() {
  const version = await platform.appVersion();
  modal({
    title: t('About'),
    build(body) {
      body.innerHTML = '<div class="about"><div class="about-logo"></div><h3></h3><p class="msg"></p><p class="msg small"></p></div>';
      body.querySelector('.about-logo').innerHTML = `<img src="${assetUrl('icon.png')}" alt="">`;
      body.querySelector('h3').textContent = `${t("Hisham's PDF Editor")} ${version}`;
      body.querySelector('.msg').textContent = t('Free and offline. Your files never leave this computer.');
      body.querySelector('.small').textContent = 'pdf.js · pdf-lib · Fabric.js · Tesseract.js · Amiri & Cairo fonts';
    },
  });
}

// ---- Find bar -----------------------------------------------------------------------------------

let findTimer = null;
function openFind() {
  if (!ed()?.hasDoc) return;
  $('findbar').hidden = false;
  $('findInput').focus();
  $('findInput').select();
}
function closeFind() {
  $('findbar').hidden = true;
  search?.clear();
  $('findCount').textContent = '';
}
$('findInput').addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(async () => {
    const e = ed();
    if (!e) return;
    if (!search || search.editor !== e) search = new Search(e);
    const q = $('findInput').value;
    const n = await search.run(q);
    $('findCount').textContent = q.trim() ? (n ? `1 / ${n}` : t('No matches')) : '';
  }, 220);
});
const findStep = (dir) => {
  if (!search?.hits.length) return;
  if (dir > 0) search.next(); else search.prev();
  $('findCount').textContent = `${search.index + 1} / ${search.hits.length}`;
};
$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('findNext').onclick = () => findStep(1);
$('findPrev').onclick = () => findStep(-1);
$('findClose').onclick = () => closeFind();
$('findNext').innerHTML = icons.down;
$('findPrev').innerHTML = icons.up;
$('findClose').innerHTML = icons.close;

// ---- Text selection bar (copy / highlight / underline / strike-through) --------------------------

function buildSelectionBar() {
  $('selbar').replaceChildren(
    button({ icon: 'copy', label: t('Copy'), onClick: () => selectionAction('copy'), cls: 'mini' }),
    button({ icon: 'highlight', label: t('Highlight'), onClick: () => selectionAction('highlight'), cls: 'mini' }),
    button({ icon: 'underline', label: t('Underline'), onClick: () => selectionAction('underline'), cls: 'mini' }),
    button({ icon: 'strike', label: t('Strike out'), onClick: () => selectionAction('strike'), cls: 'mini' }),
  );
}

function selectionPages() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const host = node.nodeType === 1 ? node : node.parentElement;
  if (!host?.closest?.('.textLayer, .page, .pages')) return null;
  const e = ed();
  if (!e) return null;
  const byView = new Map();
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const view = e.views.find((v) => { const b = v.el.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
    if (!view) continue;
    const b = view.el.getBoundingClientRect();
    const s = view.scale;
    const rect = { x: (r.left - b.left) / s, y: (r.top - b.top) / s, w: r.width / s, h: r.height / s };
    const list = byView.get(view) || [];
    // Merge touching rects on the same line.
    const same = list.find((q) => Math.abs(q.y - rect.y) < rect.h * 0.4 && rect.x <= q.x + q.w + 2 && rect.x + rect.w >= q.x - 2);
    if (same) {
      const x = Math.min(same.x, rect.x), x2 = Math.max(same.x + same.w, rect.x + rect.w);
      const y = Math.min(same.y, rect.y), y2 = Math.max(same.y + same.h, rect.y + rect.h);
      Object.assign(same, { x, y, w: x2 - x, h: y2 - y });
    } else list.push(rect);
    byView.set(view, list);
  }
  return byView.size ? { byView, text: sel.toString(), last: [...range.getClientRects()].pop() } : null;
}

function updateSelectionBar() {
  const bar = $('selbar');
  if (shared.tool !== 'select' || !ed()?.hasDoc) { bar.hidden = true; return; }
  const info = selectionPages();
  if (!info) { bar.hidden = true; return; }
  bar.hidden = false;
  const r = info.last;
  const top = r.bottom + 8 + bar.offsetHeight > window.innerHeight ? r.top - bar.offsetHeight - 8 : r.bottom + 8;
  bar.style.top = `${Math.max(8, top)}px`;
  bar.style.left = `${Math.min(window.innerWidth - bar.offsetWidth - 8, Math.max(8, r.left))}px`;
}

async function selectionAction(kind) {
  const info = selectionPages();
  $('selbar').hidden = true;
  if (!info) return;
  if (kind === 'copy') {
    try { await navigator.clipboard.writeText(info.text); } catch { document.execCommand('copy'); }
    toast(t('Copied'), 'success', 1500);
  } else {
    const color = kind === 'highlight' ? shared.props.highlight : kind === 'underline' ? '#2f6fed' : '#d92d20';
    for (const [view, rects] of info.byView) ed().addMarkup(view, rects, kind, color);
  }
  window.getSelection()?.removeAllRanges();
}

document.addEventListener('mouseup', (e) => { if (!e.target.closest?.('#selbar')) setTimeout(updateSelectionBar, 0); });
document.addEventListener('keyup', (e) => { if (e.shiftKey) updateSelectionBar(); });
$('views').addEventListener('scroll', () => { $('selbar').hidden = true; }, true);

// ---- Keyboard, mouse, drag & drop -------------------------------------------------------------------

function isTyping(e) {
  const tg = e.target;
  if (tg instanceof HTMLInputElement || tg instanceof HTMLTextAreaElement || tg instanceof HTMLSelectElement || tg?.isContentEditable) return true;
  return tabs.list.some((x) => x.editor.views.some((v) => v.canvas?.getActiveObject()?.isEditing));
}

let nudgeTimer = null;
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-back, .note-pop')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && !platform.isDesktop) { // the desktop menu's shortcuts handle these
    const map = { o: openDialog, p: print, f: openFind, w: () => tabs.active && closeTab(tabs.active), '=': () => ed()?.zoomBy(1.2), '+': () => ed()?.zoomBy(1.2), '-': () => ed()?.zoomBy(1 / 1.2), 0: () => ed()?.fitWidth() };
    if (k === 's') { e.preventDefault(); saveActive(e.shiftKey); return; }
    if (map[k]) { e.preventDefault(); map[k](); return; }
  }
  if (ctrl && e.key === 'Tab' && tabs.list.length > 1) {
    e.preventDefault();
    const i = tabs.list.indexOf(tabs.active);
    tabs.activate(tabs.list[(i + (e.shiftKey ? -1 : 1) + tabs.list.length) % tabs.list.length]);
    return;
  }
  const editor = ed();
  if (!editor?.hasDoc) return;
  if (isTyping(e)) {
    if (e.key === 'Escape') editor.finishTextEditing();
    return;
  }
  if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
  if (ctrl && k === 'y') { e.preventDefault(); editor.redo(); return; }
  if (ctrl && k === 'c') { if (editor.copySelection(clipboard)) e.preventDefault(); return; }
  if (ctrl && k === 'v') { if (clipboard.items) { e.preventDefault(); editor.paste(clipboard); } return; }
  if (ctrl && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (ctrl || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.deleteSelection()) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    for (const v of editor.views) { if (v.canvas) { v.canvas.discardActiveObject(); v.canvas.requestRenderAll(); } }
    if (!$('findbar').hidden) closeFind();
    setTool('select');
    return;
  }
  if (e.key.startsWith('Arrow')) {
    const v = editor.activeView();
    const o = v?.canvas.getActiveObject();
    if (!o) return;
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') o.left -= d;
    if (e.key === 'ArrowRight') o.left += d;
    if (e.key === 'ArrowUp') o.top -= d;
    if (e.key === 'ArrowDown') o.top += d;
    o.setCoords();
    v.canvas.requestRenderAll();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => editor.commit(v), 300);
    return;
  }
  const tool = TOOLS.find(([, , key]) => key.toLowerCase() === k);
  if (tool) { setTool(tool[0]); return; }
  if (k === 'i') insertImage();
  if (k === 's') sign();
});

$('views').addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !ed()?.hasDoc) return;
  e.preventDefault();
  ed().zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer?.types?.includes('Files');
window.addEventListener('dragenter', (e) => { if (isFileDrag(e)) { dragDepth++; document.body.classList.add('dragging-file'); } });
window.addEventListener('dragleave', (e) => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging-file'); } });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging-file');
  const files = [...e.dataTransfer.files];
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  const images = files.filter((f) => f.type.startsWith('image/'));
  const pageEl = e.target.closest?.('.page');
  for (const f of pdfs) await openFile(await platform.openDroppedFile(f));
  if (images.length && ed()?.hasDoc && !pdfs.length) {
    if (pageEl) ed().currentPage = +pageEl.dataset.index;
    for (const f of images) await run(t('Adding image…'), async () => ed().addImage(await fileToDataUrl(f), { kind: 'image' }));
  }
  if (!pdfs.length && !images.length) toast(t('Drop a PDF to open it, or an image to add it to the page.'), 'warn');
});

// ---- Desktop menu and startup ----------------------------------------------------------------------

const actions = {
  open: openDialog, save: () => saveActive(false), saveAs: () => saveActive(true), print, closeTab: () => tabs.active && closeTab(tabs.active),
  merge, split, extract, toImages, imagesToPdf: fromImages, pageNumbers, watermark, compress, ocr, password: protect,
  find: openFind, zoomIn: () => ed()?.zoomBy(1.2), zoomOut: () => ed()?.zoomBy(1 / 1.2), fit: () => ed()?.fitWidth(), night: toggleNight,
  toggleLang: () => changeLang(getLang() === 'ar' ? 'en' : 'ar'), help: showShortcuts, about: showAbout, setDefault: setDefaultApp,
  'request-close': requestAppClose,
};
platform.onMenu((action) => actions[action]?.());
platform.onOpenPath(async (p) => openFile(await platform.readPdf(p)));

window.addEventListener('beforeunload', (e) => {
  if (!platform.isDesktop && tabs.list.some((x) => x.editor.hasDoc && x.editor.dirty)) e.preventDefault();
});

$('welcomeOpen').onclick = () => openDialog();
$('welcomeImages').onclick = () => fromImages();
$('welcomeIcon').innerHTML = icons.file;
document.querySelector('.logo').innerHTML = `<img src="${assetUrl('icon.png')}" alt="">`;
document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon', href: assetUrl('icon.png') }));

async function showRecent() {
  const list = await platform.loadRecent();
  const wrap = $('recent');
  wrap.innerHTML = '';
  if (!list.length) return;
  wrap.appendChild(Object.assign(document.createElement('div'), { className: 'recent-title', textContent: t('Recent files') }));
  for (const p of list.slice(0, 6)) {
    const b = document.createElement('button');
    b.className = 'recent-item';
    b.innerHTML = `${icons.file}<span></span>`;
    b.querySelector('span').textContent = p.split(/[\\/]/).pop();
    b.title = p;
    b.onclick = async () => openFile(await platform.readPdf(p));
    wrap.appendChild(b);
  }
}

function changeLang(lang) {
  setLang(lang);
  settings.lang = lang;
  platform.storeSet('settings', settings);
  platform.setLang(lang);
}
onLangChange(() => { buildToolbar(); refreshAll(); });

// Re-measure text objects once the bundled fonts are available.
function refreshTextAfterFonts() {
  for (const tab of tabs.list) {
    for (const v of tab.editor.views) {
      if (!v.canvas) continue;
      for (const o of v.canvas.getObjects()) if (o.initDimensions && o.meta?.kind === 'text') { o.initDimensions(); o.setCoords(); }
      v.canvas.requestRenderAll();
    }
  }
}

Object.assign(window.pdfApp, { openFile, exportPdf, setTool, saveTab });
// Test hooks (used by the automated UI tests).
window.pdfTools = { addPageNumbers, addWatermark, splitGroups, splitPdf, pagesToImages, imagesToPdf, compressImages, ocrPages, pagesNeedingOcr, applyRedactions, loadPdfjs, fabric, recognizeCanvas, renderForOcr };

(async function start() {
  settings = (await platform.storeGet('settings', {})) || {};
  shared.night = !!settings.night;
  setLang(settings.lang || (navigator.language?.startsWith('ar') ? 'ar' : 'en'));
  platform.setLang(getLang());
  loadDisplayFonts().then(refreshTextAfterFonts);
  await restoreSession();
  for (const f of await platform.initialFiles()) await openFile(f);
  refreshAll();
}());
