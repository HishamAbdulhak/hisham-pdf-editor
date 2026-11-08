// Writes the overlay objects into the PDF with pdf-lib, as real vector text,
// shapes, paths and embedded images (not a flattened screenshot). Also writes
// filled-in form values, sticky-note comments, and applies password protection.
import * as fabric from 'fabric';
import {
  rgb, BlendMode, LineCapStyle, LineJoinStyle, PDFHexString, PDFString, PDFName,
  PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, setLineJoin,
} from '@cantoo/pdf-lib';
import { mul, invert, apply } from './matrix.js';
import { BASELINE } from './page.js';
import { FontSet, hasArabic } from './fonts.js';
import { pruneUnused } from './prune.js';

/** Builds the final PDF bytes for an editor's current state. */
export async function exportPdf(editor, { encrypt = true } = {}) {
  editor.finishTextEditing();
  const models = editor.snapshotModels();
  const doc = await editor.loadLib();
  doc.setProducer("Hisham's PDF Editor");
  doc.setModificationDate(new Date());
  const ctx = { doc, fonts: new FontSet(doc), images: new Map() };
  await applyFormValues(doc, editor, ctx.fonts);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const json = models[i]?.json;
    if (!json?.length) continue;
    const objects = await fabric.util.enlivenObjects(json);
    // Maps display coordinates (y down, scale 1) to PDF user space.
    const toPdf = invert(editor.views[i].vpT);
    for (const o of objects) {
      if (o.visible === false || o.meta?.kind === 'redact') continue;
      if (o.meta?.kind === 'note') addNoteAnnotation(doc, pages[i], o, toPdf);
      else await drawObject(ctx, pages[i], o, toPdf);
    }
  }
  pruneUnused(doc);
  if (encrypt && editor.protect?.userPassword) {
    doc.encrypt({ userPassword: editor.protect.userPassword, ownerPassword: editor.protect.userPassword });
  }
  return doc.save();
}

// ---- Forms -----------------------------------------------------------------------------

/** Copies values typed into the PDF's own form fields into the pdf-lib document. */
export async function applyFormValues(doc, editor, fonts) {
  const storage = editor.pdf?.annotationStorage;
  if (!storage || !storage.size) return;
  const values = storage.serializable?.map || new Map();
  if (!values.size) return;
  const fieldObjects = await editor.fieldObjects();
  let form;
  try { form = doc.getForm(); } catch { return; }
  let needsArabic = false;
  for (const [name, widgets] of Object.entries(fieldObjects)) {
    const touched = widgets.filter((w) => values.has(w.id));
    if (!touched.length) continue;
    const field = form.getFieldMaybe?.(name) ?? safe(() => form.getField(name));
    if (!field) continue;
    try {
      if (field instanceof PDFTextField) {
        const v = String(values.get(touched[0].id).value ?? '');
        if (hasArabic(v)) needsArabic = true;
        field.setText(v);
      } else if (field instanceof PDFCheckBox) {
        const v = values.get(touched[0].id).value;
        if (v === true || (typeof v === 'string' && v !== 'Off')) field.check(); else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        const on = touched.find((w) => {
          const v = values.get(w.id).value;
          return v === true || (typeof v === 'string' && v !== 'Off' && v === w.exportValues);
        });
        if (on?.exportValues) field.select(on.exportValues);
      } else if (field instanceof PDFDropdown) {
        const v = values.get(touched[0].id).value;
        const pick = Array.isArray(v) ? v[0] : v;
        if (pick != null) field.select(String(pick));
      } else if (field instanceof PDFOptionList) {
        const v = values.get(touched[0].id).value;
        field.select((Array.isArray(v) ? v : [v]).map(String));
      }
    } catch (e) { console.warn('form field', name, e); }
  }
  try {
    const font = needsArabic && fonts ? await fonts.arabic('arsans', false) : undefined;
    form.updateFieldAppearances(font);
  } catch (e) { console.warn('form appearances', e); }
}

const safe = (fn) => { try { return fn(); } catch { return null; } };

// ---- Comments ---------------------------------------------------------------------------

function addNoteAnnotation(doc, page, o, toPdf) {
  o.setCoords();
  const b = o.getBoundingRect();
  const pts = [[b.left, b.top], [b.left + b.width, b.top + b.height]].map(([x, y]) => apply(toPdf, x, y));
  const rect = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
  const meta = o.meta || {};
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: rect,
    Contents: PDFHexString.fromText(meta.text || ''),
    T: PDFHexString.fromText(meta.author || ''),
    M: PDFString.fromDate(meta.date ? new Date(meta.date) : new Date()),
    Name: PDFName.of('Comment'),
    C: [1, 0.83, 0.23],
    F: 4,
    Open: false,
  });
  page.node.addAnnot(doc.context.register(annot));
}

// ---- Drawing ------------------------------------------------------------------------------

async function drawObject(ctx, page, o, toPdf) {
  if (o.type === 'group' || o.type === 'Group') {
    for (const child of o.getObjects()) {
      if (child.visible !== false) await drawObject(ctx, page, child, toPdf);
    }
    return;
  }
  // Local frame: origin at object centre, y up, so pdf-lib's drawing helpers work as usual.
  const m = mul(mul(toPdf, o.calcTransformMatrix()), [1, 0, 0, -1, 0, 0]);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  try {
    const opacity = (o.opacity ?? 1) * (o.group?.opacity ?? 1);
    const w = o.width, h = o.height;
    const multiply = o.globalCompositeOperation === 'multiply' ? BlendMode.Multiply : undefined;
    switch (o.type.toLowerCase()) {
      case 'rect': {
        const fill = color(o.fill);
        const stroke = o.strokeWidth > 0 ? color(o.stroke) : null;
        if (!fill && !stroke) break;
        page.drawRectangle({
          x: -w / 2, y: -h / 2, width: w, height: h,
          color: fill?.rgb, opacity: fill ? fill.a * opacity : undefined,
          borderColor: stroke?.rgb, borderWidth: stroke ? o.strokeWidth : 0,
          borderOpacity: stroke ? stroke.a * opacity : undefined,
          blendMode: multiply,
        });
        break;
      }
      case 'ellipse': {
        const fill = color(o.fill);
        const stroke = o.strokeWidth > 0 ? color(o.stroke) : null;
        page.drawEllipse({
          x: 0, y: 0, xScale: o.rx, yScale: o.ry,
          color: fill?.rgb, opacity: fill ? fill.a * opacity : undefined,
          borderColor: stroke?.rgb, borderWidth: stroke ? o.strokeWidth : 0,
          borderOpacity: stroke ? stroke.a * opacity : undefined,
        });
        break;
      }
      case 'line': {
        const stroke = color(o.stroke);
        if (!stroke) break;
        const p = o.calcLinePoints();
        page.drawLine({
          start: { x: p.x1, y: -p.y1 }, end: { x: p.x2, y: -p.y2 },
          thickness: o.strokeWidth, color: stroke.rgb, opacity: stroke.a * opacity,
          lineCap: LineCapStyle.Round,
        });
        break;
      }
      case 'path': {
        const stroke = color(o.stroke);
        const fill = color(o.fill);
        if (!stroke && !fill) break;
        page.pushOperators(setLineJoin(LineJoinStyle.Round));
        page.drawSvgPath(pathString(o), {
          x: 0, y: 0,
          color: fill?.rgb, opacity: fill ? fill.a * opacity : undefined,
          borderColor: stroke?.rgb, borderWidth: stroke ? o.strokeWidth : undefined, borderOpacity: stroke ? stroke.a * opacity : undefined,
          borderLineCap: o.strokeLineCap === 'round' ? LineCapStyle.Round : LineCapStyle.Projecting,
          blendMode: multiply,
        });
        break;
      }
      case 'image': {
        const img = await embedImage(ctx, o.getSrc());
        page.drawImage(img, { x: -w / 2, y: -h / 2, width: w, height: h, opacity });
        break;
      }
      case 'textbox':
      case 'i-text':
      case 'text':
        await drawText(ctx, page, o, opacity);
        break;
      default:
        // Anything unexpected is rasterised so it still appears in the output.
        await drawRaster(ctx, page, o);
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

async function drawText(ctx, page, o, opacity) {
  const family = o.meta?.font || 'Helvetica';
  const bold = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600;
  const italic = o.fontStyle === 'italic';
  const lines = o.textLines || String(o.text).split('\n');
  let layouts;
  try {
    layouts = [];
    for (const line of lines) layouts.push(await ctx.fonts.layout(line, { family, bold, italic, size: o.fontSize }));
  } catch {
    return drawRaster(ctx, page, o); // characters no embedded font can show (e.g. emoji)
  }
  const fill = color(o.fill) || { rgb: rgb(0, 0, 0), a: 1 };
  const w = o.width, h = o.height;
  let y = h / 2; // top edge in the y-up local frame
  layouts.forEach((lay, i) => {
    const baseline = y - o.fontSize * BASELINE;
    const align = o.textAlign?.replace('justify-', '').replace('justify', o.direction === 'rtl' ? 'right' : 'left');
    let x = -w / 2;
    if (align === 'center') x = -lay.width / 2;
    else if (align === 'right') x = w / 2 - lay.width;
    const x0 = x;
    for (const run of lay.runs) {
      page.drawText(run.text, { x, y: baseline, size: o.fontSize, font: run.font, color: fill.rgb, opacity: fill.a * opacity });
      x += run.width;
    }
    if (o.underline && lay.width) {
      page.drawLine({ start: { x: x0, y: baseline - o.fontSize * 0.12 }, end: { x: x0 + lay.width, y: baseline - o.fontSize * 0.12 }, thickness: o.fontSize / 15, color: fill.rgb });
    }
    y -= o.getHeightOfLine(i);
  });
}

async function drawRaster(ctx, page, o) {
  const k = 4;
  const el = o.toCanvasElement({ multiplier: k, withoutTransform: true, enableRetinaScaling: false });
  const img = await embedImage(ctx, el.toDataURL('image/png'));
  const w = el.width / k, h = el.height / k;
  page.drawImage(img, { x: -w / 2, y: -h / 2, width: w, height: h });
}

export async function embedImage(ctx, src) {
  if (ctx.images.has(src)) return ctx.images.get(src);
  const p = (async () => {
    let url = src;
    if (!/^data:image\/(png|jpe?g);/i.test(url)) url = await toPngDataUrl(url);
    const bytes = dataUrlBytes(url);
    return /^data:image\/png/i.test(url) ? ctx.doc.embedPng(bytes) : ctx.doc.embedJpg(bytes);
  })();
  ctx.images.set(src, p);
  return p;
}

export function toPngDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

export function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Fabric path commands -> SVG path string relative to the object centre.
function pathString(o) {
  const ox = o.pathOffset.x, oy = o.pathOffset.y;
  return o.path.map(([cmd, ...n]) => {
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push(n[i] - ox, n[i + 1] - oy);
    return `${cmd.toUpperCase()} ${pts.join(' ')}`;
  }).join(' ');
}

function color(value) {
  if (!value || typeof value !== 'string' || value === 'transparent') return null;
  const [r, g, b, a] = new fabric.Color(value).getSource();
  if (a === 0) return null;
  return { rgb: rgb(r / 255, g / 255, b / 255), a: a ?? 1 };
}
