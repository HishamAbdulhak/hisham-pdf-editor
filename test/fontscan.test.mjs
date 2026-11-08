// The system-font reader: names, styles, licence flags, and unpacking one font from a .ttc collection.
// Uses the bundled look-alike fonts, so it runs on any machine. Run: node test/fontscan.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';
import fontkit from '@cantoo/fontkit';
import { stripBitmapTables } from '../src/sfnt.js';

const require = createRequire(import.meta.url);
const { readFaces, faceBytes } = require('../electron/fontscan.js');
const vendor = (f) => path.join(import.meta.dirname, '..', 'vendor', 'fonts', f);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfe-fontscan-'));

// Names and style come from the font file itself.
const [bold] = readFaces(vendor('carlito-700i.ttf'));
assert.equal(bold.family, 'Carlito');
assert.equal(bold.weight, 700);
assert.equal(bold.italic, true);
assert.equal(bold.restricted, false);

// Licence flags (OS/2 fsType) decide whether a font may be embedded, and whether whole.
function withFsType(file, fsType) {
  const b = Buffer.from(fs.readFileSync(vendor(file)));
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (b.toString('latin1', r, r + 4) === 'OS/2') b.writeUInt16BE(fsType, b.readUInt32BE(r + 8) + 8);
  }
  const out = path.join(tmp, `fs-${fsType}-${file}`);
  fs.writeFileSync(out, b);
  return readFaces(out)[0];
}
assert.equal(withFsType('arimo-400n.ttf', 0x0002).restricted, true, 'restricted licence');
assert.equal(withFsType('arimo-400n.ttf', 0x0200).restricted, true, 'bitmap-only licence');
assert.equal(withFsType('arimo-400n.ttf', 0x0100).noSubset, true, 'no-subsetting licence');
assert.equal(withFsType('arimo-400n.ttf', 0x0000).restricted, false);

// Packs fonts into a .ttc collection (table offsets become file offsets).
function makeTtc(files) {
  const fonts = files.map((f) => fs.readFileSync(vendor(f)));
  const header = 12 + fonts.length * 4;
  let pos = header;
  const offsets = fonts.map((f) => { const at = pos; pos += (f.length + 3) & ~3; return at; });
  const ttc = Buffer.alloc(pos);
  ttc.write('ttcf', 0, 'latin1');
  ttc.writeUInt32BE(0x00010000, 4);
  ttc.writeUInt32BE(fonts.length, 8);
  fonts.forEach((f, i) => {
    ttc.writeUInt32BE(offsets[i], 12 + i * 4);
    f.copy(ttc, offsets[i]);
    const n = f.readUInt16BE(4);
    for (let t = 0; t < n; t++) {
      const r = offsets[i] + 12 + t * 16 + 8;
      ttc.writeUInt32BE(ttc.readUInt32BE(r) + offsets[i], r);
    }
  });
  const out = path.join(tmp, 'pair.ttc');
  fs.writeFileSync(out, ttc);
  return out;
}
const ttc = makeTtc(['tinos-400n.ttf', 'caladea-700n.ttf']);
const faces = readFaces(ttc);
assert.deepEqual(faces.map((f) => [f.family, f.index]), [['Tinos', 0], ['Caladea', 1]]);
const second = fontkit.create(faceBytes(ttc, 1));
assert.equal(second.familyName, 'Caladea');
assert.ok(second.hasGlyphForCodePoint(0x41), 'unpacked face keeps its glyphs');

// Removing bitmap tables leaves outlines usable; fonts without them are returned unchanged.
const plain = fs.readFileSync(vendor('arimo-400n.ttf'));
assert.equal(stripBitmapTables(plain).length, plain.length);
const calibri = 'C:/Windows/Fonts/calibri.ttf'; // has EBDT/EBLC bitmaps (Windows only)
if (fs.existsSync(calibri)) {
  const stripped = fontkit.create(stripBitmapTables(fs.readFileSync(calibri)));
  assert.ok(!stripped.directory.tables.EBDT && !stripped.directory.tables.EBLC);
  const sub = stripped.createSubset();
  sub.includeGlyph(stripped.glyphForCodePoint(0x41).id);
  assert.ok(sub.encode().length > 0, 'Calibri can be subset once bitmaps are removed');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('fontscan tests passed');
