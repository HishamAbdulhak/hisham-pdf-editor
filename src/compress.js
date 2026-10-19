// Reduce file size: re-encode the images inside the PDF as smaller JPEGs.
// Text and vector graphics are untouched, so they stay sharp and selectable.
import { PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict } from '@cantoo/pdf-lib';
import { unzlibSync } from 'fflate';

export const LEVELS = {
  low: { maxDim: 1100, quality: 0.5 }, // smallest file
  medium: { maxDim: 1700, quality: 0.68 },
  high: { maxDim: 2400, quality: 0.82 }, // best quality
};

/** Re-encodes images in a pdf-lib document in place. Returns how many were replaced. */
export async function compressImages(doc, level = 'medium', onProgress) {
  const { maxDim, quality } = LEVELS[level];
  const ctx = doc.context;
  const images = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && name(obj.dict.get(PDFName.of('Subtype'))) === 'Image') images.push([ref, obj]);
  }
  let replaced = 0;
  for (const [i, [ref, stream]] of images.entries()) {
    onProgress?.(i / images.length);
    try {
      const out = await reencode(ctx, stream, maxDim, quality);
      if (out && out.bytes.length < stream.contents.length * 0.9) {
        const dict = {
          Type: 'XObject', Subtype: 'Image', Width: out.width, Height: out.height,
          ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
        };
        const smask = stream.dict.get(PDFName.of('SMask'));
        const newStream = ctx.stream(out.bytes, dict);
        if (smask) newStream.dict.set(PDFName.of('SMask'), smask);
        ctx.assign(ref, newStream);
        replaced++;
      }
    } catch (e) { console.warn('compress image', e); }
  }
  return replaced;
}

function name(v) { return v ? v.asString?.().replace(/^\//, '') ?? String(v).replace(/^\//, '') : null; }
function num(dict, key) { const v = dict.get(PDFName.of(key)); return v instanceof PDFNumber ? v.asNumber() : null; }

async function reencode(ctx, stream, maxDim, quality) {
  const d = stream.dict;
  if (d.get(PDFName.of('ImageMask'))) return null;
  if (d.get(PDFName.of('Decode'))) return null;
  let filter = d.get(PDFName.of('Filter'));
  if (filter instanceof PDFArray) {
    if (filter.size() !== 1) return null;
    filter = filter.get(0);
  }
  filter = name(filter);
  const width = num(d, 'Width'), height = num(d, 'Height');
  if (!width || !height || width * height < 40000) return null; // tiny images aren't worth it
  const cs = colorSpace(ctx, d.get(PDFName.of('ColorSpace')));

  let bitmap;
  if (filter === 'DCTDecode') {
    if (cs === 'cmyk') return null; // browsers decode CMYK JPEGs inconsistently
    bitmap = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
  } else if (filter === 'FlateDecode') {
    if (num(d, 'BitsPerComponent') !== 8 || (cs !== 'rgb' && cs !== 'gray')) return null;
    const comps = cs === 'rgb' ? 3 : 1;
    let raw = unzlibSync(stream.contents);
    const parms = d.get(PDFName.of('DecodeParms'));
    const predictor = parms instanceof PDFDict ? num(parms, 'Predictor') : null;
    if (predictor && predictor >= 10) raw = unpredictPng(raw, width, height, comps);
    else if (predictor && predictor !== 1) return null;
    if (raw.length < width * height * comps) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let p = 0, q = 0; p < width * height; p++, q += comps) {
      rgba[p * 4] = raw[q];
      rgba[p * 4 + 1] = comps === 3 ? raw[q + 1] : raw[q];
      rgba[p * 4 + 2] = comps === 3 ? raw[q + 2] : raw[q];
      rgba[p * 4 + 3] = 255;
    }
    bitmap = await createImageBitmap(new ImageData(rgba, width, height));
  } else return null;

  const k = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close?.();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
}

function colorSpace(ctx, v) {
  const obj = v && ctx.lookup(v);
  const n = name(obj);
  if (n === 'DeviceRGB' || n === 'CalRGB') return 'rgb';
  if (n === 'DeviceGray' || n === 'CalGray') return 'gray';
  if (n === 'DeviceCMYK') return 'cmyk';
  if (obj instanceof PDFArray) {
    const kind = name(obj.get(0));
    if (kind === 'ICCBased') {
      const icc = ctx.lookup(obj.get(1));
      const comps = icc?.dict ? num(icc.dict, 'N') : null;
      return comps === 3 ? 'rgb' : comps === 1 ? 'gray' : comps === 4 ? 'cmyk' : null;
    }
    if (kind === 'CalRGB') return 'rgb';
    if (kind === 'CalGray') return 'gray';
  }
  return null;
}

// Reverses PNG row filters (PDF predictors 10–15).
function unpredictPng(data, width, height, comps) {
  const stride = width * comps;
  const out = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const type = data[y * (stride + 1)];
    const row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= comps ? cur[x - comps] : 0;
      const b = prev[x];
      const c = x >= comps ? prev[x - comps] : 0;
      let v = row[x];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return out;
}
