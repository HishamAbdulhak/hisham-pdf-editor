// Small UI helpers: icons, toasts, progress, modal dialogs, dropdown menus.
import { t } from './i18n.js';

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  open: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: P('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h9V3"/><rect x="7" y="13" width="10" height="7"/>'),
  select: P('<path d="M5 3l14 8-6 2-3 6z"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/><path d="M14 20h6"/>'),
  text: P('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  pen: P('<path d="M3 21c3-1 5-3 7-6l7-7a2.1 2.1 0 0 0-3-3l-7 7c-3 2-5 4-6 7z"/>'),
  highlight: P('<path d="M9 11l-5 5v4h4l5-5"/><path d="M9 11l6-6 4 4-6 6z"/><path d="M14 20h7"/>'),
  rect: P('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
  ellipse: P('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
  line: P('<path d="M5 19L19 5"/>'),
  arrow: P('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'),
  whiteout: P('<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 12h10" stroke-dasharray="2 2"/>'),
  redact: P('<rect x="3" y="6" width="18" height="12" rx="1.5" fill="currentColor" fill-opacity=".85"/><path d="M6 21h12"/>'),
  eraser: P('<path d="M7 21h12"/><path d="M4 15l9-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-8 8H8z"/>'),
  note: P('<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>'),
  stamp: P('<path d="M9 3h6v5l3 4H6l3-4z"/><rect x="4" y="12" width="16" height="4" rx="1"/><path d="M5 20h14"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
  sign: P('<path d="M3 17c2-4 4-9 6-9s-1 9 1 9 3-5 5-5 1 4 3 4 2-1 3-2"/><path d="M3 21h18"/>'),
  undo: P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: P('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  zoomIn: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6M11 8v6"/>'),
  zoomOut: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6"/>'),
  fit: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  find: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'),
  night: P('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  tools: P('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  print: P('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  lock: P('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  ocr: P('<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
  compress: P('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  split: P('<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/><path d="M12 2v20" stroke-dasharray="2 2"/>'),
  numbers: P('<path d="M4 6h2v6M4 12h4M14 6h5l-5 6h5M4 18h16"/>'),
  watermark: P('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  images: P('<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="M17 16l-4-4-7 7"/>'),
  rotL: P('<path d="M3 4v6h6"/><path d="M3.5 15a8.5 8.5 0 1 0 2-9L3 10"/>'),
  rotR: P('<path d="M21 4v6h-6"/><path d="M20.5 15a8.5 8.5 0 1 1-2-9L21 10"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  plusPage: P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>'),
  merge: P('<path d="M8 3H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3"/><rect x="10" y="6" width="11" height="15" rx="2"/><path d="M15.5 10.5v6M12.5 13.5h6"/>'),
  extract: P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 18v-7M9 14l3-3 3 3"/>'),
  bold: P('<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>'),
  italic: P('<path d="M10 4h8M6 20h8M15 4L9 20"/>'),
  underline: P('<path d="M7 4v7a5 5 0 0 0 10 0V4M5 21h14"/>'),
  strike: P('<path d="M5 12h14M16 6.5A4 4 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 1.5 1 2.3 3 3M8 17.5a4 4 0 0 0 4 1.5c2.5 0 4-1.3 4-3"/>'),
  alignL: P('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignC: P('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignR: P('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  copy: P('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  front: P('<rect x="8" y="8" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  file: P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  bookmark: P('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  pages: P('<rect x="4" y="3" width="11" height="14" rx="1.5"/><path d="M9 21h9a2 2 0 0 0 2-2V8"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  up: P('<path d="M6 15l6-6 6 6"/>'),
  down: P('<path d="M6 9l6 6 6-6"/>'),
  check: P('<path d="M5 12l5 5 9-10"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
};

export function toast(message, kind = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// Busy indicator with optional progress (0..1).
let busyCount = 0;
export function busy(on, label = t('Working…')) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  const el = document.getElementById('busy');
  el.querySelector('span').textContent = label;
  el.querySelector('.bar i').style.width = '0%';
  el.classList.remove('has-progress');
  el.hidden = busyCount <= 0;
}
export function progress(fraction, label) {
  const el = document.getElementById('busy');
  el.classList.add('has-progress');
  el.querySelector('.bar i').style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  if (label) el.querySelector('span').textContent = label;
}

// Opens a modal; `build(body, close)` fills it. Resolves with the value passed to close().
export function modal({ title, build, width = 460 }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.style.width = `min(${width}px, calc(100vw - 32px))`;
    box.innerHTML = `<header><h2></h2><button class="icon-btn" data-close>${icons.close}</button></header><div class="modal-body"></div>`;
    box.querySelector('h2').textContent = title;
    box.querySelector('[data-close]').title = t('Close');
    back.appendChild(box);
    document.body.appendChild(back);
    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    box.querySelector('[data-close]').onclick = () => close(null);
    build(box.querySelector('.modal-body'), close);
    setTimeout(() => box.querySelector('input:not([type=hidden]), select, textarea, .btn.primary')?.focus(), 0);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Generic form dialog. fields: [{ key, label, type: text|password|number|select|radio|checkbox|color|range|note,
 * value, options: [[value,label]], min, max, step, show: (values) => bool }]
 * Resolves with an object of values, or null if cancelled.
 */
export function formModal({ title, fields, okLabel = t('OK'), width = 460, intro, validate }) {
  return modal({
    title,
    width,
    build(body, close) {
      const form = document.createElement('form');
      form.className = 'form';
      if (intro) {
        const p = document.createElement('p');
        p.className = 'msg';
        p.textContent = intro;
        form.appendChild(p);
      }
      const rows = [];
      for (const f of fields) {
        const row = document.createElement('div');
        row.className = `field field-${f.type}`;
        const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
        let html = '';
        if (f.type === 'note') html = `<p class="msg small">${esc(f.label)}</p>`;
        else if (f.type === 'checkbox') html = `<label class="check"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
        else if (f.type === 'radio') {
          html = `<span class="label">${esc(f.label)}</span><div class="radios">${f.options.map(([v, l]) => `<label class="radio"><input type="radio" name="${id}" value="${esc(v)}" ${v === f.value ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
        } else if (f.type === 'select') {
          html = `<label for="${id}">${esc(f.label)}</label><select id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
        } else if (f.type === 'range') {
          html = `<label for="${id}">${esc(f.label)} <output></output></label><input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${f.value}">`;
        } else {
          html = `<label for="${id}">${esc(f.label)}</label><input type="${f.type}" id="${id}" value="${esc(f.value ?? '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step != null ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
        }
        row.innerHTML = html;
        form.appendChild(row);
        rows.push({ f, row });
      }
      const err = document.createElement('p');
      err.className = 'form-error';
      err.hidden = true;
      form.appendChild(err);
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      actions.innerHTML = `<button type="button" class="btn" data-cancel></button><button type="submit" class="btn primary"></button>`;
      actions.querySelector('[data-cancel]').textContent = t('Cancel');
      actions.querySelector('[type=submit]').textContent = okLabel;
      actions.querySelector('[data-cancel]').onclick = () => close(null);
      form.appendChild(actions);
      body.appendChild(form);

      const read = () => {
        const v = {};
        for (const { f, row } of rows) {
          if (f.type === 'note') continue;
          if (f.type === 'checkbox') v[f.key] = row.querySelector('input').checked;
          else if (f.type === 'radio') v[f.key] = row.querySelector('input:checked')?.value;
          else if (f.type === 'number' || f.type === 'range') v[f.key] = Number(row.querySelector('input').value);
          else v[f.key] = row.querySelector('input, select').value;
        }
        return v;
      };
      const refresh = () => {
        const v = read();
        for (const { f, row } of rows) {
          row.hidden = f.show ? !f.show(v) : false;
          if (f.type === 'range') row.querySelector('output').textContent = f.format ? f.format(v[f.key]) : v[f.key];
        }
      };
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      refresh();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = read();
        const problem = validate?.(v);
        if (problem) { err.textContent = problem; err.hidden = false; return; }
        close(v);
      });
    },
  });
}

export function promptText({ title, label, value = '', placeholder = '', okLabel = t('OK'), type = 'text' }) {
  return formModal({ title, okLabel, fields: [{ key: 'v', label, type, value, placeholder }] }).then((r) => (r ? r.v : null));
}

export function confirmBox({ title, message, okLabel = t('OK'), danger = false, extra }) {
  return modal({
    title,
    build(body, close) {
      body.innerHTML = `<p class="msg"></p><div class="modal-actions">${extra ? '<button class="btn" data-extra></button><span class="spacer"></span>' : ''}<button class="btn" data-cancel></button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok></button></div>`;
      body.querySelector('.msg').textContent = message;
      body.querySelector('[data-cancel]').textContent = t('Cancel');
      body.querySelector('[data-ok]').textContent = okLabel;
      body.querySelector('[data-cancel]').onclick = () => close(false);
      body.querySelector('[data-ok]').onclick = () => close(true);
      if (extra) {
        body.querySelector('[data-extra]').textContent = extra;
        body.querySelector('[data-extra]').onclick = () => close('extra');
      }
    },
  }).then((v) => (v === 'extra' ? 'extra' : !!v));
}

// Dropdown menu anchored to a button. items: [{ icon, label, onClick, disabled } | 'sep']
export function dropdown(anchor, items) {
  document.querySelector('.dropdown')?.remove();
  const menu = document.createElement('div');
  menu.className = 'dropdown';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === 'sep') { menu.appendChild(Object.assign(document.createElement('div'), { className: 'sep' })); continue; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `${icons[it.icon] || ''}<span></span>`;
    b.querySelector('span').textContent = it.label;
    b.disabled = !!it.disabled;
    b.onclick = () => { menu.remove(); it.onClick(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const left = rtl ? Math.max(8, r.right - menu.offsetWidth) : Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 4}px`;
  const off = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', off, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  menu.querySelector('button:not(:disabled)')?.focus();
}

// Toast with buttons that stays until answered (or times out -> null). buttons: [{ label, value, primary }]
export function askToast(message, buttons, ms = 30000) {
  return new Promise((resolve) => {
    const host = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ask';
    el.setAttribute('role', 'alertdialog');
    el.appendChild(Object.assign(document.createElement('div'), { textContent: message }));
    const row = Object.assign(document.createElement('div'), { className: 'toast-actions' });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
      resolve(v);
    };
    for (const b of buttons) {
      const btn = Object.assign(document.createElement('button'), { textContent: b.label, className: b.primary ? 'primary' : '' });
      btn.onclick = () => finish(b.value);
      row.appendChild(btn);
    }
    el.appendChild(row);
    host.appendChild(el);
    setTimeout(() => finish(null), ms);
  });
}

// Searchable list popup (used by the font picker). items: [{ label, value, font, group }]
export function searchList(anchor, { items, current, onPick, placeholder = '' }) {
  document.querySelector('.dropdown')?.remove();
  const menu = document.createElement('div');
  menu.className = 'dropdown search-list';
  const input = Object.assign(document.createElement('input'), { type: 'search', placeholder, className: 'search-list-input' });
  const list = Object.assign(document.createElement('div'), { className: 'search-list-items' });
  list.setAttribute('role', 'listbox');
  menu.append(input, list);
  const close = () => { menu.remove(); document.removeEventListener('mousedown', off, true); };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    let group = null;
    let shown = 0;
    for (const it of items) {
      if (q && !it.label.toLowerCase().includes(q)) continue;
      if (it.group && it.group !== group && !q) {
        group = it.group;
        list.appendChild(Object.assign(document.createElement('div'), { className: 'search-list-group', textContent: group }));
      }
      const b = document.createElement('button');
      b.setAttribute('role', 'option');
      b.textContent = it.label;
      if (it.font) b.style.fontFamily = it.font;
      if (it.value === current) { b.classList.add('on'); b.setAttribute('aria-selected', 'true'); }
      b.onclick = () => { close(); onPick(it.value); };
      list.appendChild(b);
      if (++shown >= 400) break;
    }
  };
  input.oninput = render;
  input.onkeydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') list.querySelector('button')?.click();
    if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('button')?.focus(); }
  };
  render();
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  menu.style.left = `${rtl ? Math.max(8, r.right - menu.offsetWidth) : Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  input.focus();
  list.querySelector('.on')?.scrollIntoView({ block: 'center' });
}
