// Removes screen-only tables (embedded bitmaps, colour layers) from a TrueType/OpenType font.
// fontkit treats glyphs in such fonts (e.g. Windows' Calibri, which has EBDT/EBLC) as bitmaps
// and cannot subset them; PDFs only need the outlines.
const DROP = new Set(['EBDT', 'EBLC', 'EBSC', 'CBDT', 'CBLC', 'sbix', 'COLR', 'CPAL', 'SVG ']);

export function stripBitmapTables(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (src.length < 12) return src;
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const version = dv.getUint32(0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) return src; // not a plain sfnt
  const num = dv.getUint16(4);
  const tables = [];
  for (let i = 0; i < num; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(src[r], src[r + 1], src[r + 2], src[r + 3]);
    tables.push({ tag, checksum: dv.getUint32(r + 4), offset: dv.getUint32(r + 8), length: dv.getUint32(r + 12) });
  }
  const keep = tables.filter((t) => !DROP.has(t.tag));
  if (keep.length === tables.length) return src;
  const pad = (n) => (n + 3) & ~3;
  let pos = 12 + keep.length * 16;
  const at = keep.map((t) => { const p = pos; pos += pad(t.length); return p; });
  const out = new Uint8Array(pos);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, version);
  ov.setUint16(4, keep.length);
  let es = 0;
  while ((1 << (es + 1)) <= keep.length) es++;
  ov.setUint16(6, (1 << es) * 16);
  ov.setUint16(8, es);
  ov.setUint16(10, keep.length * 16 - (1 << es) * 16);
  keep.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[r + j] = t.tag.charCodeAt(j);
    ov.setUint32(r + 4, t.checksum);
    ov.setUint32(r + 8, at[i]);
    ov.setUint32(r + 12, t.length);
    out.set(src.subarray(t.offset, t.offset + t.length), at[i]);
  });
  return out;
}
