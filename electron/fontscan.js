// System fonts for the desktop app: finds installed font files, reads their names
// (without any npm dependency, since only electron/** ships), caches the index,
// and returns one face as a standalone TrueType/OpenType file (TTC faces are unpacked).
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_VERSION = 2; // bump when the fields read from font files change
const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i;

function fontDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const win = process.env.WINDIR || 'C:\\Windows';
    return [path.join(win, 'Fonts'), path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')];
  }
  if (process.platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local', 'share', 'fonts')];
}

function listFiles(dir, out = [], depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) listFiles(p, out, depth + 1);
    else if (FONT_EXT.test(e.name)) out.push(p);
  }
  return out;
}

// ---- reading just the bits of a font file we need -------------------------------------------

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return n === len ? b : b.subarray(0, n);
}

function tableDir(fd, offset) {
  const head = readAt(fd, offset, 12);
  const num = head.readUInt16BE(4);
  const dir = readAt(fd, offset + 12, num * 16);
  const tables = {};
  for (let i = 0; i < num; i++) {
    const tag = dir.toString('latin1', i * 16, i * 16 + 4);
    tables[tag] = { checksum: dir.readUInt32BE(i * 16 + 4), offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) };
  }
  return { sfntVersion: head.readUInt32BE(0), tables };
}

function faceOffsets(fd) {
  const tag = readAt(fd, 0, 4).toString('latin1');
  if (tag !== 'ttcf') return [0];
  const h = readAt(fd, 8, 4);
  const n = Math.min(h.readUInt32BE(0), 64);
  const offs = readAt(fd, 12, n * 4);
  return Array.from({ length: n }, (_, i) => offs.readUInt32BE(i * 4));
}

function decodeName(buf, platform, encoding) {
  if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0))) {
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
    return s;
  }
  if (platform === 1 && encoding === 0) return buf.toString('latin1');
  return null;
}

function readNames(fd, t) {
  if (!t) return {};
  const b = readAt(fd, t.offset, t.length);
  const count = b.readUInt16BE(2);
  const strOff = b.readUInt16BE(4);
  const best = {}; // nameID -> [score, value]
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > b.length) break;
    const platform = b.readUInt16BE(r), encoding = b.readUInt16BE(r + 2), lang = b.readUInt16BE(r + 4);
    const id = b.readUInt16BE(r + 6), len = b.readUInt16BE(r + 8), off = b.readUInt16BE(r + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const value = decodeName(b.subarray(strOff + off, strOff + off + len), platform, encoding);
    if (!value) continue;
    // Prefer Windows English (US), then any English, then anything.
    const score = (platform === 3 && lang === 0x409 ? 3 : 0) + (platform === 1 && lang === 0 ? 2 : 0) + 1;
    if (!best[id] || score > best[id][0]) best[id] = [score, value.replace(/\0/g, '').trim()];
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v[1]]));
}

function readOs2(fd, t) {
  if (!t || t.length < 64) return {};
  const b = readAt(fd, t.offset, Math.min(t.length, 78));
  return { weight: b.readUInt16BE(4), fsType: b.readUInt16BE(8), fsSelection: b.readUInt16BE(62) };
}

function readFaces(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const faces = [];
    faceOffsets(fd).forEach((off, index) => {
      try {
        const { tables } = tableDir(fd, off);
        if (!tables.cmap || !(tables.glyf || tables['CFF '] || tables.CFF2)) return; // bitmap-only or unusable
        const n = readNames(fd, tables.name);
        const os2 = readOs2(fd, tables['OS/2']);
        const family = n[16] || n[1];
        if (!family || family.startsWith('.')) return;
        const style = n[17] || n[2] || 'Regular';
        const italic = !!(os2.fsSelection & 1) || /italic|oblique/i.test(style);
        const weight = os2.weight || (/black|heavy/i.test(style) ? 900 : /bold/i.test(style) ? 700 : /light/i.test(style) ? 300 : 400);
        faces.push({
          file, index, family, style, full: n[4] || `${family} ${style}`, ps: n[6] || '',
          weight, italic,
          // Licence flags (OS/2 fsType): "restricted" (0x0002) or "bitmap embedding only" (0x0200)
          // mean outlines must not go into a PDF; 0x0100 means the font must be embedded whole.
          restricted: ((os2.fsType || 0) & 0x000f) === 0x0002 || !!((os2.fsType || 0) & 0x0200),
          noSubset: !!((os2.fsType || 0) & 0x0100),
        });
      } catch { /* damaged face */ }
    });
    return faces;
  } finally {
    fs.closeSync(fd);
  }
}

// ---- index with a cache keyed by file size + mtime ----------------------------------------

async function buildIndex(cacheFile, extraDirs = []) {
  let cache = {};
  try {
    const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (saved.version === CACHE_VERSION) cache = saved.files || {};
  } catch { /* first run */ }
  const files = {};
  let read = 0;
  for (const dir of [...fontDirs(), ...extraDirs]) {
    for (const file of listFiles(dir)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
      const hit = cache[file];
      if (hit && hit.stamp === stamp) { files[file] = hit; continue; }
      // Yield now and then so the app stays responsive during the first scan.
      if (++read % 25 === 0) await new Promise((r) => setImmediate(r));
      let faces = [];
      try { faces = readFaces(file); } catch { /* unreadable */ }
      files[file] = { stamp, faces };
    }
  }
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: CACHE_VERSION, files }));
  } catch { /* read-only profile */ }
  const faces = [];
  for (const f of Object.values(files)) faces.push(...f.faces);
  return faces;
}

// ---- one face as a standalone font file ---------------------------------------------------

const pad4 = (n) => (n + 3) & ~3;

function faceBytes(file, index = 0) {
  const fd = fs.openSync(file, 'r');
  try {
    const offs = faceOffsets(fd);
    if (offs.length === 1 && index === 0 && readAt(fd, 0, 4).toString('latin1') !== 'ttcf') {
      return fs.readFileSync(file);
    }
    const { sfntVersion, tables } = tableDir(fd, offs[index] ?? offs[0]);
    const tags = Object.keys(tables).sort();
    const num = tags.length;
    let pos = 12 + num * 16;
    const parts = tags.map((tag) => {
      const t = tables[tag];
      const data = readAt(fd, t.offset, t.length);
      const at = pos;
      pos += pad4(t.length);
      return { tag, t, data, at };
    });
    const out = Buffer.alloc(pos);
    out.writeUInt32BE(sfntVersion, 0);
    out.writeUInt16BE(num, 4);
    let es = 0;
    while ((1 << (es + 1)) <= num) es++;
    out.writeUInt16BE((1 << es) * 16, 6);
    out.writeUInt16BE(es, 8);
    out.writeUInt16BE(num * 16 - (1 << es) * 16, 10);
    parts.forEach((p, i) => {
      const r = 12 + i * 16;
      out.write(p.tag, r, 4, 'latin1');
      out.writeUInt32BE(p.t.checksum, r + 4);
      out.writeUInt32BE(p.at, r + 8);
      out.writeUInt32BE(p.t.length, r + 12);
      p.data.copy(out, p.at);
    });
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { buildIndex, faceBytes, readFaces };
