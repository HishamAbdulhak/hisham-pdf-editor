// Deleted or redacted pages must not survive inside the saved file.
// Run: node test/prune.test.mjs
import fs from 'fs';
import zlib from 'zlib';
import assert from 'assert';
import { PDFDocument } from '@cantoo/pdf-lib';
import { pruneUnused } from '../src/prune.js';

// Text inside every stream of the file, inflated where compressed.
function rawText(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  let out = '';
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let body = s.slice(start, s.indexOf('endstream', start));
    try { body = zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); } catch { /* not compressed */ }
    out += body;
  }
  return out;
}
const JOHN = '4A6F686E20536D697468'; // "John Smith" as pdf-lib writes it (hex)

const doc = await PDFDocument.load(fs.readFileSync(new URL('./sample.pdf', import.meta.url)));
const { width, height } = doc.getPage(0).getSize();
doc.insertPage(0, [width, height]); // what Redact does: new flattened page in front...
doc.removePage(1); // ...and the original page removed
pruneUnused(doc);
const bytes = await doc.save();

assert.ok(!rawText(bytes).toUpperCase().includes(JOHN), 'removed page text is still inside the file');
const reread = await PDFDocument.load(bytes);
assert.strictEqual(reread.getPageCount(), 2, 'other pages must survive');
assert.ok(reread.getForm().getFields().length >= 0);
console.log('prune test passed');
