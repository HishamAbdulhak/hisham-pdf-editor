// Find in document (Ctrl+F): case-insensitive, ignores Arabic diacritics.
import { mul } from './matrix.js';

// Removes Arabic diacritics and tatweel, lower-cases; keeps a map back to original indices.
function normalize(str) {
  let out = '';
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (/[ً-ٰٟـ]/.test(ch)) continue;
    out += ch.toLowerCase();
    map.push(i);
  }
  return { out, map };
}

export class Search {
  constructor(editor) {
    this.editor = editor;
    this.hits = [];
    this.index = -1;
    this.query = '';
    this.pageText = new Map(); // view -> {text, spans}
  }

  async pageData(view) {
    if (this.pageText.has(view)) return this.pageText.get(view);
    const tc = await view.pdfPage.getTextContent();
    let text = '';
    const spans = [];
    for (const item of tc.items) {
      if (typeof item.str !== 'string') continue;
      const start = text.length;
      text += item.str;
      spans.push({ start, end: text.length, item });
      text += item.hasEOL ? ' ' : '';
    }
    const norm = normalize(text);
    const data = { text, norm, spans };
    this.pageText.set(view, data);
    return data;
  }

  async run(query) {
    this.clear();
    this.query = query;
    const q = normalize(query.trim()).out;
    if (!q) return 0;
    for (const view of this.editor.views) {
      if (this.query !== query) return 0; // superseded by a newer search
      const { norm, spans } = await this.pageData(view);
      let from = 0;
      for (;;) {
        const at = norm.out.indexOf(q, from);
        if (at < 0) break;
        from = at + q.length;
        const s = norm.map[at], e = norm.map[at + q.length - 1] + 1;
        const rects = [];
        for (const sp of spans) {
          if (sp.end <= s || sp.start >= e) continue;
          rects.push(spanRect(view, sp, Math.max(s, sp.start) - sp.start, Math.min(e, sp.end) - sp.start));
        }
        if (rects.length) this.hits.push({ view, rects });
      }
    }
    if (this.hits.length) this.go(0);
    return this.hits.length;
  }

  go(i) {
    if (!this.hits.length) return;
    this.index = (i + this.hits.length) % this.hits.length;
    const active = this.hits[this.index];
    const byView = new Map();
    this.hits.forEach((h, n) => {
      const list = byView.get(h.view) || [];
      for (const r of h.rects) list.push({ ...r, active: n === this.index });
      byView.set(h.view, list);
    });
    for (const v of this.editor.views) {
      const list = byView.get(v) || [];
      v.setSearchHits(list, list.findIndex((r) => r.active));
    }
    this.editor.scrollToPage(active.view.index, active.rects[0].y);
  }

  next() { this.go(this.index + 1); }
  prev() { this.go(this.index - 1); }

  clear() {
    this.hits = [];
    this.index = -1;
    for (const v of this.editor.views) v.setSearchHits([], -1);
  }
}

// Approximate box for characters [a, b) of a text item (proportional character widths).
function spanRect(view, sp, a, b) {
  const { item } = sp;
  const t = mul(view.vpT, item.transform);
  const fs = Math.hypot(t[2], t[3]);
  const len = Math.max(1, item.str.length);
  const rtl = item.dir === 'rtl';
  const f0 = rtl ? 1 - b / len : a / len;
  const f1 = rtl ? 1 - a / len : b / len;
  return { x: t[4] + item.width * f0, y: t[5] - fs * 0.86, w: Math.max(2, item.width * (f1 - f0)), h: fs * 1.12 };
}
