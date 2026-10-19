// Fonts: what the user can pick, how they display on screen, and how they are
// embedded into PDFs (including Arabic shaping and right-to-left ordering).
import fontkit from '@cantoo/fontkit';
import bidiFactory from 'bidi-js';
import { StandardFonts } from '@cantoo/pdf-lib';
import { assetBytes } from './assets.js';

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

  arabic(style, bold) {
    const file = `fonts/${style}-${bold ? 700 : 400}.ttf`;
    return this.get(file, async () => this.doc.embedFont(await assetBytes(file), { subset: true }));
  }

  // Splits one line into visually ordered runs, each drawable with a single font.
  async layout(text, { family = 'Helvetica', bold = false, italic = false, size }) {
    const runs = [];
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
      const key = useArabic(i) ? `ar:${arabicStyle}` : 'latin';
      const contiguous = cur && cur.key === key && cur.rtl === rtl && (rtl ? i === cur.min - 1 : i === cur.max + 1);
      if (contiguous) { cur.min = Math.min(cur.min, i); cur.max = Math.max(cur.max, i); continue; }
      cur = { key, rtl, min: i, max: i };
      runs.push(cur);
    }
    let width = 0;
    for (const r of runs) {
      r.text = text.slice(r.min, r.max + 1);
      r.font = r.key === 'latin' ? await this.latin(family, bold, italic) : await this.arabic(arabicStyle, bold);
      r.font.encodeText(r.text); // throws for characters the font can't show
      r.width = r.font.widthOfTextAtSize(r.text, size);
      width += r.width;
    }
    return { runs, width, rtl: rtlBase };
  }
}
