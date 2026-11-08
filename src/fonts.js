// Fonts: what the user can pick, how they display on screen, and how they are
// embedded into PDFs (including Arabic shaping and right-to-left ordering).
import fontkit from '@cantoo/fontkit';
import bidiFactory from 'bidi-js';
import { StandardFonts } from '@cantoo/pdf-lib';
import { assetBytes } from './assets.js';
import { stripBitmapTables } from './sfnt.js';
import { isNamed, familyOf, familyBytes, embeddedFont, cssFamily } from './fontlib.js';

const bidi = bidiFactory();

// Family keys stored on text objects (meta.font).
export const FAMILIES = ['Helvetica', 'Times', 'Courier', 'Naskh', 'ArSans'];

// CSS stacks used on screen. Arabic falls back to the same fonts (Amiri, Cairo) that are embedded on save.
export const FONTS = {
  Helvetica: 'Arial, Helvetica, "PDFE ArSans", sans-serif',
  Times: '"Times New Roman", Times, "PDFE Naskh", serif',
  Courier: '"Courier New", Courier, "PDFE ArSans", monospace',
  Naskh: '"PDFE Naskh", "Times New Roman", serif',
  ArSans: '"PDFE ArSans", Arial, sans-serif',
};

// CSS font-family for a text object's meta ({ font, generic, embedded }).
export const fontCss = (meta) => cssFamily(meta || {}, FONTS);
export const FONT_KEYS = new Set(FAMILIES);

const STD = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
// Which Arabic font pairs with each Latin family.
const ARABIC_FOR = { Helvetica: 'arsans', Courier: 'arsans', ArSans: 'arsans', Times: 'naskh', Naskh: 'naskh' };

let displayFontsReady = null;
// Registers the bundled fonts with the browser so text looks the same on screen as in the PDF.
export function loadDisplayFonts() {
  if (displayFontsReady) return displayFontsReady;
  const list = [
    ['PDFE Naskh', 'fonts/naskh-400.ttf', '400'], ['PDFE Naskh', 'fonts/naskh-700.ttf', '700'],
    ['PDFE ArSans', 'fonts/arsans-400.ttf', '400'], ['PDFE ArSans', 'fonts/arsans-700.ttf', '700'],
    ['Great Vibes', 'fonts/great-vibes.woff2', '400'], ['Dancing Script', 'fonts/dancing-script.woff2', '400'],
  ];
  displayFontsReady = Promise.all(list.map(async ([family, file, weight]) => {
    try {
      const face = new FontFace(family, await assetBytes(file), { weight });
      document.fonts.add(await face.load());
    } catch (e) { console.warn('font', file, e); }
  }));
  return displayFontsReady;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (s) => ARABIC_RE.test(s);
export const isRtlText = (s) => {
  const m = s.match(/[A-Za-zÀ-ɏ؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/);
  return !!m && ARABIC_RE.test(m[0]);
};

// Embeds fonts into one pdf-lib document on demand.
export class FontSet {
  constructor(doc) {
    this.doc = doc;
    this.cache = new Map();
    doc.registerFontkit(fontkit);
  }

  get(key, loader) {
    if (!this.cache.has(key)) this.cache.set(key, loader());
    return this.cache.get(key);
  }

  latin(family, bold, italic) {
    const set = STD[family];
    if (!set) return this.arabic(ARABIC_FOR[family], bold);
    const name = set[(bold ? 1 : 0) + (italic ? 2 : 0)];
    return this.get(name, () => this.doc.embedFont(name));
  }

  // A named family (installed / downloaded / look-alike) or a font copied from the source PDF.
  // Resolves to null when nothing is available, so callers fall back to the built-ins.
  custom(family, bold, italic) {
    return this.get(`f:${family}|${bold}|${italic}`, async () => {
      const r = await familyBytes(family, bold, italic);
      return r ? this.embedBytes(r.bytes, { noSubset: r.noSubset }) : null;
    });
  }

  embedded(k) {
    return this.get(`e:${k}`, async () => {
      const f = embeddedFont(k);
      return f ? this.embedBytes(f.bytes) : null;
    });
  }

  async embedBytes(bytes, { noSubset = false } = {}) {
    bytes = stripBitmapTables(bytes);
    // Subsetting CFF-based (OpenType "OTTO") fonts is unreliable in pdf-lib, so embed those whole,
    // as well as fonts whose licence forbids subsetting.
    const cff = bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f;
    try { return await this.doc.embedFont(bytes, { subset: !cff && !noSubset }); } catch (e) { console.warn('embed font', e); return null; }
  }

  arabic(style, bold) {
    const file = `fonts/${style}-${bold ? 700 : 400}.ttf`;
    return this.get(file, async () => this.doc.embedFont(await assetBytes(file), { subset: true }));
  }

  // Splits one line into visually ordered runs, each drawable with a single font.
  async layout(text, { family = 'Helvetica', generic, embedded, bold = false, italic = false, size }) {
    const runs = [];
    // Named fonts: try the PDF's own font, then the family, per character; built-ins catch the rest.
    const named = isNamed(family);
    const base = named ? (generic && FONT_KEYS.has(generic) ? generic : 'Helvetica') : family;
    const customs = [];
    if (named) {
      const emb = embedded ? await this.embedded(embedded) : null;
      if (emb && embeddedFont(embedded).bold === !!bold && embeddedFont(embedded).italic === !!italic) customs.push(emb);
      const fam = await this.custom(familyOf(family), bold, italic);
      if (fam) customs.push(fam);
    }
    const customFor = (ch) => {
      const cp = ch.codePointAt(0);
      for (let n = 0; n < customs.length; n++) {
        const fk = customs[n].embedder?.font;
        if (fk?.hasGlyphForCodePoint?.(cp)) return n;
      }
      return -1;
    };
    family = base;
    if (!text) return { runs, width: 0 };
    const rtlBase = isRtlText(text);
    const embedding = bidi.getEmbeddingLevels(text, rtlBase ? 'rtl' : 'ltr');
    const { levels } = embedding;
    const order = [...text].map((_, i) => i);
    // getReorderSegments works on UTF-16 indices; text here is BMP-only in practice.
    for (const [start, end] of bidi.getReorderSegments(text, embedding)) {
      const seg = order.slice(start, end + 1).reverse();
      order.splice(start, seg.length, ...seg);
    }
    const arabicStyle = ARABIC_FOR[family];
    const useArabic = (i) => family === 'Naskh' || family === 'ArSans' || ARABIC_RE.test(text[i]) || (levels[i] & 1 && !/[A-Za-z]/.test(text[i]));
    let cur = null;
    for (const i of order) {
      const rtl = !!(levels[i] & 1);
      let key = useArabic(i) ? `ar:${arabicStyle}` : 'latin';
      if (customs.length && !ARABIC_RE.test(text[i])) {
        const n = customFor(text[i]);
        if (n >= 0) key = `c${n}`;
      }
      const contiguous = cur && cur.key === key && cur.rtl === rtl && (rtl ? i === cur.min - 1 : i === cur.max + 1);
      if (contiguous) { cur.min = Math.min(cur.min, i); cur.max = Math.max(cur.max, i); continue; }
      cur = { key, rtl, min: i, max: i };
      runs.push(cur);
    }
    let width = 0;
    for (const r of runs) {
      r.text = text.slice(r.min, r.max + 1);
      if (r.key[0] === 'c') r.font = customs[Number(r.key.slice(1))];
      else r.font = r.key === 'latin' ? await this.latin(family, bold, italic) : await this.arabic(arabicStyle, bold);
      r.font.encodeText(r.text); // throws for characters the font can't show
      r.width = r.font.widthOfTextAtSize(r.text, size);
      width += r.width;
    }
    return { runs, width, rtl: rtlBase };
  }
}
