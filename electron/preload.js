const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readPdf: (filePath) => ipcRenderer.invoke('read-pdf', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
  pickImages: (multi) => ipcRenderer.invoke('pick-images', multi),
  savePdf: (opts) => ipcRenderer.invoke('save-pdf', opts),
  saveFiles: (opts) => ipcRenderer.invoke('save-files', opts),
  storeGet: (name, fallback) => ipcRenderer.invoke('store-get', name, fallback),
  storeSet: (name, value) => ipcRenderer.invoke('store-set', name, value),
  loadRecent: () => ipcRenderer.invoke('recent-load'),
  recoveryPut: (key, meta, bytes) => ipcRenderer.invoke('recovery-put', key, meta, bytes),
  recoveryGet: (key) => ipcRenderer.invoke('recovery-get', key),
  recoveryRemove: (key) => ipcRenderer.invoke('recovery-remove', key),
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  openDefaultApps: () => ipcRenderer.invoke('open-default-apps'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  setDirty: (count) => ipcRenderer.send('set-dirty', count),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  setLang: (lang) => ipcRenderer.send('set-lang', lang),
  closeNow: () => ipcRenderer.send('close-now'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
});

// Only answered when the app runs its automated tests (PDFE_TEST).
contextBridge.exposeInMainWorld('pdfeTest', {
  shot: (name) => ipcRenderer.invoke('test-shot', name),
  read: (p) => ipcRenderer.invoke('test-read', p),
  input: (events) => ipcRenderer.invoke('test-input', events),
  write: (name, data) => ipcRenderer.invoke('test-write', name, data),
});
