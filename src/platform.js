// Thin wrapper over the desktop (Electron) API, with browser fallbacks so the
// same UI runs as a single HTML file.
import { zipSync } from 'fflate';
import { promptText } from './ui.js';
import { t } from './i18n.js';

const desktop = window.desktop;
export const isDesktop = !!desktop;

function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export const fileToBytes = (file) => file.arrayBuffer().then((b) => new Uint8Array(b));
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ---- browser storage helpers ------------------------------------------------------------
const local = {
  get(name, fallback) { try { return JSON.parse(localStorage.getItem(`pdfe:${name}`)) ?? fallback; } catch { return fallback; } },
  set(name, value) { try { localStorage.setItem(`pdfe:${name}`, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
};

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('hisham-pdf-editor', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('recovery');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idb(mode, fn) {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction('recovery', mode);
      const req = fn(tx.objectStore('recovery'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } catch { return null; }
}

export const platform = {
  isDesktop,

  async openDialog() {
    if (desktop) return desktop.openDialog();
    const files = await pickFiles('application/pdf,.pdf', true);
    return Promise.all(files.map(async (f) => ({ path: null, name: f.name, data: await fileToBytes(f) })));
  },
  async openDroppedFile(file) {
    if (desktop) {
      const p = desktop.pathForFile(file);
      if (p) return desktop.readPdf(p);
    }
    return { path: null, name: file.name, data: await fileToBytes(file) };
  },
  readPdf: (p) => desktop.readPdf(p),
  fileExists: (p) => (desktop ? desktop.fileExists(p) : Promise.resolve(false)),

  async pickPdf() {
    if (desktop) return desktop.pickPdf();
    const [f] = await pickFiles('application/pdf,.pdf');
    return f ? { name: f.name, data: await fileToBytes(f) } : null;
  },
  async pickImages(multi = false) {
    if (desktop) return desktop.pickImages(multi);
    const files = await pickFiles('image/*', multi);
    return Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await fileToDataUrl(f) })));
  },

  // filePath set => quiet save to that file (desktop). Otherwise ask for a name.
  async savePdf({ data, filePath, defaultPath }) {
    if (desktop) return desktop.savePdf({ data, filePath, defaultPath });
    const suggested = (defaultPath || 'document.pdf').split(/[\\/]/).pop();
    let name = await promptText({ title: t('Save PDF'), label: t('File name'), value: suggested, okLabel: t('Save') });
    if (!name) return null;
    name = name.trim();
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    download(data, name, 'application/pdf');
    return { path: null, name };
  },

  // Several output files: a folder on desktop, a ZIP download in the browser.
  async saveFiles({ files, baseName }) {
    if (desktop) return desktop.saveFiles({ files });
    const entries = Object.fromEntries(files.map((f) => [f.name, [f.data, { level: 0 }]]));
    download(zipSync(entries), `${baseName}.zip`, 'application/zip');
    return { count: files.length };
  },

  async storeGet(name, fallback) { return desktop ? desktop.storeGet(name, fallback) : local.get(name, fallback); },
  async storeSet(name, value) { return desktop ? desktop.storeSet(name, value) : local.set(name, value); },
  async loadRecent() { return desktop ? desktop.loadRecent() : []; },

  async recoveryPut(key, meta, bytes) {
    if (desktop) return desktop.recoveryPut(key, meta, bytes);
    const prev = bytes ? null : await idb('readonly', (s) => s.get(key));
    return idb('readwrite', (s) => s.put({ meta: { ...meta, key }, bytes: bytes || prev?.bytes || null }, key));
  },
  async recoveryGet(key) { return desktop ? desktop.recoveryGet(key) : idb('readonly', (s) => s.get(key)); },
  async recoveryRemove(key) { return desktop ? desktop.recoveryRemove(key) : idb('readwrite', (s) => s.delete(key)); },

  async initialFiles() { return desktop ? desktop.initialFiles() : []; },
  async openDefaultApps() { if (desktop) await desktop.openDefaultApps(); },
  // Installed fonts: [{ file, index, family, style, full, ps, weight, italic, restricted }].
  async listSystemFonts() {
    if (desktop) return desktop.fontsList();
    if (!window.queryLocalFonts) return [];
    try {
      const list = await window.queryLocalFonts();
      return list.map((f) => ({
        file: f.postscriptName, index: 0, family: f.family, style: f.style, full: f.fullName, ps: f.postscriptName,
        weight: /black|heavy/i.test(f.style) ? 900 : /bold/i.test(f.style) ? 700 : /light/i.test(f.style) ? 300 : 400,
        italic: /italic|oblique/i.test(f.style), restricted: false, local: f,
      }));
    } catch { return []; }
  },
  async systemFontBytes(face) {
    if (desktop) return desktop.fontBytes(face.file, face.index);
    return face.local ? new Uint8Array(await (await face.local.blob()).arrayBuffer()) : null;
  },
  async downloadFont(family) { return desktop ? desktop.fontDownload(family) : { ok: false, reason: 'unsupported' }; },
  async appVersion() { return desktop ? desktop.appVersion() : '1.0.0'; },
  setDirty(n) { if (desktop) desktop.setDirty(n); },
  setTitle(title) { if (desktop) desktop.setTitle(title); else document.title = title; },
  setLang(lang) { if (desktop) desktop.setLang(lang); },
  closeNow() { if (desktop) desktop.closeNow(); },
  onMenu(cb) { if (desktop) desktop.onMenu(cb); },
  onOpenPath(cb) { if (desktop) desktop.onOpenPath(cb); },
};
