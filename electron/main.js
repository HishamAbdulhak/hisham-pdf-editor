const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = "Hisham's PDF Editor";
const OUT_DIR = path.join(__dirname, '..', 'out');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.gz': 'application/gzip',
};

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.hisham.pdfeditor');

// The UI is served from app://local/ so ES modules and workers load normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let forceClose = false;
let dirtyCount = 0;
const pendingPaths = findPdfArgs(process.argv);

function findPdfArgs(argv) {
  return argv.slice(1).filter((a) => /\.pdf$/i.test(a) && fs.existsSync(a)).map((a) => path.resolve(a));
}

// ---- small JSON/file stores in the user's app-data folder -----------------------------
const dataDir = () => app.getPath('userData');
const dataFile = (name) => path.join(dataDir(), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(name), JSON.stringify(value));
}
const recoveryDir = () => path.join(dataDir(), 'recovery');
const recoveryBase = (key) => path.join(recoveryDir(), crypto.createHash('sha1').update(String(key)).digest('hex'));

function addRecent(filePath) {
  const list = readJson('recent.json', []).filter((p) => p !== filePath);
  list.unshift(filePath);
  writeJson('recent.json', list.slice(0, 10));
}

function loadPdf(filePath) {
  filePath = path.resolve(filePath);
  const data = fs.readFileSync(filePath);
  addRecent(filePath);
  return { path: filePath, name: path.basename(filePath), data: new Uint8Array(data) };
}

function createWindow() {
  const state = readJson('window.json', { width: 1400, height: 900 });
  win = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#eef0f3',
    icon: path.join(OUT_DIR, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
    if (TEST) console.log('STARTUP ready-to-show', Math.round(performance.now()), 'ms after launch');
  });
  win.loadURL('app://local/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    const b = win.getNormalBounds();
    writeJson('window.json', { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() });
    if (forceClose || dirtyCount === 0) return;
    e.preventDefault();
    win.webContents.send('menu', 'request-close');
  });
  win.on('closed', () => { win = null; });
  if (TEST) runTest();
}

// ---- Automated UI tests: PDFE_TEST=<script.js> PDFE_TEST_OUT=<dir> electron . ----------------
const TEST = process.env.PDFE_TEST;
if (TEST) app.setPath('userData', path.resolve(process.env.PDFE_TEST_OUT || app.getPath('temp'), 'userdata'));

function runTest() {
  const out = path.resolve(process.env.PDFE_TEST_OUT || app.getPath('temp'));
  fs.mkdirSync(out, { recursive: true });
  ipcMain.handle('test-shot', async (_e, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    return true;
  });
  ipcMain.handle('test-input', async (_e, events) => {
    for (const ev of events) {
      if (ev.wait) { await new Promise((r) => setTimeout(r, ev.wait)); continue; }
      win.webContents.sendInputEvent(ev);
    }
    return true;
  });
  ipcMain.handle('test-read', (_e, p) => new Uint8Array(fs.readFileSync(path.resolve(process.env.PDFE_TEST_ROOT || '.', p))));
  ipcMain.handle('test-write', (_e, name, data) => { fs.writeFileSync(path.join(out, name), Buffer.from(data)); return true; });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}]`, e.message, `(${e.sourceId}:${e.lineNumber})`); });
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const code = fs.readFileSync(TEST, 'utf8');
      const result = await win.webContents.executeJavaScript(`(async () => { ${code} })()`);
      console.log('TEST RESULT', JSON.stringify(result, null, 1));
    } catch (e) {
      console.log('TEST ERROR', e.message);
    }
    forceClose = true;
    app.quit();
  });
}

function send(action) { if (win) win.webContents.send('menu', action); }

function buildMenu(lang = 'en') {
  const ar = lang === 'ar';
  const L = (en, a) => (ar ? a : en);
  const template = [
    {
      label: L('File', 'ملف'),
      submenu: [
        { label: L('Open…', 'فتح…'), accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: L('Create PDF from Images…', 'إنشاء PDF من صور…'), click: () => send('imagesToPdf') },
        { type: 'separator' },
        { label: L('Save', 'حفظ'), accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: L('Save As…', 'حفظ باسم…'), accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { label: L('Password Protection…', 'الحماية بكلمة مرور…'), click: () => send('password') },
        { type: 'separator' },
        { label: L('Print…', 'طباعة…'), accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: L('Close Tab', 'إغلاق التبويب'), accelerator: 'CmdOrCtrl+W', click: () => send('closeTab') },
        { role: 'quit', label: L('Exit', 'خروج') },
      ],
    },
    {
      label: L('Tools', 'أدوات'),
      submenu: [
        { label: L('Recognize Text (OCR)…', 'التعرف على النص (OCR)…'), click: () => send('ocr') },
        { label: L('Reduce File Size…', 'تقليل حجم الملف…'), click: () => send('compress') },
        { type: 'separator' },
        { label: L('Merge PDF…', 'دمج ملف PDF…'), click: () => send('merge') },
        { label: L('Split PDF…', 'تقسيم ملف PDF…'), click: () => send('split') },
        { label: L('Extract Pages…', 'استخراج صفحات…'), click: () => send('extract') },
        { label: L('Export Pages as Images…', 'تصدير الصفحات كصور…'), click: () => send('toImages') },
        { type: 'separator' },
        { label: L('Page Numbers…', 'ترقيم الصفحات…'), click: () => send('pageNumbers') },
        { label: L('Watermark…', 'علامة مائية…'), click: () => send('watermark') },
      ],
    },
    {
      label: L('View', 'عرض'),
      submenu: [
        { label: L('Find…', 'بحث…'), accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { type: 'separator' },
        { label: L('Zoom In', 'تكبير'), accelerator: 'CmdOrCtrl+=', click: () => send('zoomIn') },
        { label: L('Zoom Out', 'تصغير'), accelerator: 'CmdOrCtrl+-', click: () => send('zoomOut') },
        { label: L('Fit Width', 'ملاءمة العرض'), accelerator: 'CmdOrCtrl+0', click: () => send('fit') },
        { label: L('Night Mode', 'الوضع الليلي'), click: () => send('night') },
        { type: 'separator' },
        { label: L('العربية / English', 'English / العربية'), click: () => send('toggleLang') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L('Full Screen', 'ملء الشاشة') },
        { role: 'toggleDevTools', label: L('Developer Tools', 'أدوات المطور') },
      ],
    },
    {
      label: L('Help', 'مساعدة'),
      submenu: [
        { label: L('Keyboard Shortcuts', 'اختصارات لوحة المفاتيح'), click: () => send('help') },
        { label: L('Set as Default PDF App…', 'تعيين كتطبيق PDF الافتراضي…'), click: () => send('setDefault') },
        { label: L('About', 'حول'), click: () => send('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC -----------------------------------------------------------------------------------

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths.map(loadPdf);
});

ipcMain.handle('read-pdf', (_e, filePath) => loadPdf(filePath));
ipcMain.handle('file-exists', (_e, filePath) => !!filePath && fs.existsSync(filePath));

ipcMain.handle('pick-pdf', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) };
});

ipcMain.handle('pick-images', async (_e, multi) => {
  const r = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (r.canceled) return [];
  return r.filePaths.map((p) => {
    const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return { name: path.basename(p), dataUrl: `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}` };
  });
});

// Writes straight to filePath when given (quiet save), otherwise asks with a dialog.
ipcMain.handle('save-pdf', async (_e, { data, filePath, defaultPath }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultPath || 'document.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, Buffer.from(data));
  addRecent(target);
  return { path: target, name: path.basename(target) };
});

// Asks for a folder and writes several files into it.
ipcMain.handle('save-files', async (_e, { files, defaultFolder }) => {
  const r = await dialog.showOpenDialog(win, {
    defaultPath: defaultFolder,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  for (const f of files) fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.data));
  shell.openPath(dir);
  return { folder: dir, count: files.length };
});

ipcMain.handle('store-get', (_e, name, fallback) => readJson(`${name}.json`, fallback));
ipcMain.handle('store-set', (_e, name, value) => { writeJson(`${name}.json`, value); return true; });
ipcMain.handle('recent-load', () => readJson('recent.json', []).filter((p) => fs.existsSync(p)));

ipcMain.handle('recovery-put', (_e, key, meta, bytes) => {
  fs.mkdirSync(recoveryDir(), { recursive: true });
  const base = recoveryBase(key);
  if (bytes) fs.writeFileSync(`${base}.pdf`, Buffer.from(bytes));
  fs.writeFileSync(`${base}.json`, JSON.stringify({ ...meta, key, hasBytes: !!bytes || fs.existsSync(`${base}.pdf`) }));
  return true;
});
ipcMain.handle('recovery-get', (_e, key) => {
  const base = recoveryBase(key);
  try {
    const meta = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    const bytes = fs.existsSync(`${base}.pdf`) ? new Uint8Array(fs.readFileSync(`${base}.pdf`)) : null;
    return { meta, bytes };
  } catch { return null; }
});
ipcMain.handle('recovery-remove', (_e, key) => {
  const base = recoveryBase(key);
  fs.rmSync(`${base}.json`, { force: true });
  fs.rmSync(`${base}.pdf`, { force: true });
  return true;
});

ipcMain.handle('initial-files', () => pendingPaths.splice(0).map(loadPdf));
ipcMain.handle('open-default-apps', () => shell.openExternal('ms-settings:defaultapps'));
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.on('set-dirty', (_e, count) => { dirtyCount = count; });
ipcMain.on('set-title', (_e, title) => { if (win) win.setTitle(title); });
ipcMain.on('set-lang', (_e, lang) => buildMenu(lang));
ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    for (const p of findPdfArgs(argv)) win.webContents.send('open-path', p);
  });

  app.whenReady().then(() => {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = path.normalize(path.join(OUT_DIR, rel));
      if (!filePath.startsWith(OUT_DIR)) return new Response('Forbidden', { status: 403 });
      try {
        const body = await fs.promises.readFile(filePath);
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        return new Response(body, { headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    buildMenu(readJson('settings.json', {}).lang || 'en');
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
