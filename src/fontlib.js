// Real fonts beyond the five built-in choices: the fonts embedded in the open PDF,
// fonts installed on this computer, bundled look-alikes, and fonts downloaded with
// the user's consent. Mirrors how Office/Acrobat find fonts.
//
// Text objects store:
//   meta.font     'Helvetica' | 'Times' | ... (built-in)  or  'f:<Family>' (a named family)
//   meta.generic  built-in key used as the last-resort fallback for a named family
//   meta.embedded key of the font program copied from the source PDF (optional)
import fontkit from '@cantoo/fontkit';
import { platform } from './platform.js';
import { assetBytes } from './assets.js';

export const isNamed = (font) => typeof font === 'string' && font.startsWith('f:');
export const familyOf = (font) => (isNamed(font) ? font.slice(2) : null);
export const namedId = (family) => `f:${family}`;

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---- Bundled metric-compatible look-alikes ---------------------------------------------------
// Look-alike -> the fonts it stands in for (it also stands in for itself).
const GROUPS = {
  Arimo: ['Arial', 'Helvetica', 'Helvetica Neue', 'Liberation Sans'],
  Tinos: ['Times New Roman', 'Times', 'Times Roman', 'Liberation Serif'],
  Cousine: ['Courier New', 'Courier', 'Liberation Mono'],
  Carlito: ['Calibri'],
  Caladea: ['Cambria'],
};
const LOOKALIKES = new Map(Object.entries(GROUPS).flatMap(([alt, names]) => [alt, ...names].map((name) => [key(name), { name, alt }])));
export const lookalikeFor = (family) => LOOKALIKES.get(key(family))?.alt || null;

// Built-in font to fall back to for a family, guessed from its name.
export function genericFor(family) {
  const k = key(family);
  if (/mono|courier|consol|code|typewriter/.test(k)) return 'Courier';
  if (/times|serif|georgia|garamond|cambria|caladea|tinos|palatino|minion|book|roman|baskerville|bodoni|century|didot/.test(k) && !/sans/.test(k)) return 'Times';
  return 'Helvetica';
}

// ---- PDF font names ---------------------------------------------------------------------------
const STYLE_WORDS = /(bold|italic|oblique|regular|roman|book|medium|semibold|demibold|light|black|heavy|condensed|narrow|it|bd|bdit)+$/;

// "ABCDEF+TimesNewRomanPS-BoldItalicMT" -> { family: 'TimesNewRoman', candidates: [...], bold, italic }
export function parsePdfFontName(raw) {
  const name = String(raw || '').replace(/^[A-Z]{6}\+/, '').trim();
  if (!name) return null;
  const [base, style = ''] = name.split(/[-,]/, 2);
  const s = `${style} ${name}`.toLowerCase();
  const baseKey = key(base);
  const stripped = baseKey.replace(/(psmt|mt|ps)$/, '');
  const noStyle = stripped.replace(STYLE_WORDS, '');
  return {
    name,
    base,
    candidates: [...new Set([key(name), baseKey, stripped, noStyle].filter((k) => k.length > 1))],
    bold: /bold|black|heavy|semibold|demi/.test(s),
    italic: /italic|oblique|(^|[^a-z])it($|[^a-z])/.test(s),
  };
}

// "TimesNewRoman" -> "Times New Roman" (only used when no installed family matches).
export const prettyName = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();

// ---- System font index (installed + downloaded) --------------------------------------------------
let systemList = null;
let byKey = null; // normalised family / postscript / full name -> family
export function systemFonts() {
  if (!systemList) {
    systemList = platform.listSystemFonts().then((list) => {
      byKey = new Map();
      for (const f of list) {
        if (f.restricted) continue; // licence forbids embedding in PDFs
        for (const k of [key(f.family), key(f.ps), key(f.full)]) if (k && !byKey.has(k)) byKey.set(k, f.family);
      }
      return list.filter((f) => !f.restricted);
    }).catch(() => { byKey = new Map(); return []; });
  }
  return systemList;
}
export function refreshSystemFonts() { systemList = null; prepared = new Map(); return systemFonts(); }

export async function familyNames() {
  const list = await systemFonts();
  return [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
}

const familyFaces = async (family) => (await systemFonts()).filter((f) => key(f.family) === key(family));

// Picks the face closest to the wanted weight/style, avoiding narrow/condensed variants.
function pickFace(faces, bold, italic) {
  const want = bold ? 700 : 400;
  let best = null, bestScore = Infinity;
  for (const f of faces) {
    const score = Math.abs((f.weight || 400) - want) + (!!f.italic !== !!italic ? 1000 : 0)
      + (/narrow|condensed|compressed|extended|wide/i.test(`${f.style} ${f.full}`) ? 500 : 0);
    if (score < bestScore) { best = f; bestScore = score; }
  }
  return best;
}

// Finds which family a PDF font corresponds to.
// -> { family, installed, lookalike } or null when the built-ins should be kept.
// The PDF standard fonts are already the built-ins (no embedding needed), so they are left alone.
const STANDARD_14 = new Set(['helvetica', 'times', 'timesroman', 'courier', 'symbol', 'zapfdingbats']);

export async function matchPdfFont(rawName, { standard = false } = {}) {
  const p = parsePdfFontName(rawName);
  if (!p) return null;
  if (!standard && STANDARD_14.has(key(p.base))) return null;
  await systemFonts();
  for (const c of p.candidates) {
    const fam = byKey.get(c);
    if (fam) return { family: fam, installed: true, lookalike: null };
  }
  for (const c of p.candidates) {
    // Keep the original's real name so it is used if this file is opened where it is installed.
    const l = LOOKALIKES.get(c);
    if (l) return { family: l.name, installed: false, lookalike: l.alt };
  }
  return { family: prettyName(p.base.replace(/(PSMT|MT|PS)$/, '')), installed: false, lookalike: null };
}

// ---- Font bytes for a family/style --------------------------------------------------------------
const bytesCache = new Map();
const cached = (k, fn) => { if (!bytesCache.has(k)) bytesCache.set(k, fn().catch((e) => { bytesCache.delete(k); throw e; })); return bytesCache.get(k); };

function lookalikeFile(alt, bold, italic) {
  return `fonts/lookalike/${alt.toLowerCase()}-${bold ? 700 : 400}${italic ? 'i' : 'n'}.ttf`;
}

// -> { bytes, source: 'system'|'web'|'lookalike', label, noSubset } or null
export async function familyBytes(family, bold, italic) {
  const faces = await familyFaces(family);
  if (faces.length) {
    const f = pickFace(faces, bold, italic);
    const bytes = await cached(`sys:${f.file}#${f.index}`, () => platform.systemFontBytes(f));
    if (bytes) return { bytes, source: f.web ? 'web' : 'system', label: f.full, noSubset: !!f.noSubset };
  }
  const alt = lookalikeFor(family);
  if (alt) {
    const file = lookalikeFile(alt, bold, italic);
    try { return { bytes: await cached(file, () => assetBytes(file)), source: 'lookalike', label: alt }; } catch { /* single-file build has none */ }
  }
  return null;
}

// Is there anything to draw this family with (installed, downloaded or look-alike)?
export async function familyAvailable(family) {
  return (await familyFaces(family)).length > 0 || !!lookalikeFor(family);
}

// ---- On-screen display -------------------------------------------------------------------------
// Installed fonts are used by CSS name directly. Look-alikes and downloaded fonts are
// registered as FontFaces; embedded PDF fonts get their own family.
const registered = new Map();
function addFace(family, bytes, { weight = '400', style = 'normal' } = {}) {
  const k = `${family}|${weight}|${style}`;
  if (!registered.has(k)) {
    registered.set(k, (async () => {
      const face = new FontFace(family, bytes, { weight: String(weight), style });
      document.fonts.add(await face.load());
    })().catch((e) => console.warn('font face', family, e)));
  }
  return registered.get(k);
}
const quote = (s) => `"${String(s).replace(/["\\]/g, '')}"`;

// Makes sure the family can be drawn on screen (once per family; reset when fonts are downloaded).
let prepared = new Map();
export function prepareDisplay(family) {
  const k = key(family);
  if (!prepared.has(k)) prepared.set(k, loadDisplay(family));
  return prepared.get(k);
}
async function loadDisplay(family) {
  const faces = await familyFaces(family);
  const web = faces.filter((f) => f.web);
  await Promise.all(web.map(async (f) => addFace(`PDFE W ${f.family}`, await platform.systemFontBytes(f), { weight: f.weight, style: f.italic ? 'italic' : 'normal' })));
  const alt = lookalikeFor(family);
  if (!alt || faces.length) return;
  const jobs = [];
  for (const bold of [false, true]) for (const italic of [false, true]) {
    jobs.push(assetBytes(lookalikeFile(alt, bold, italic))
      .then((b) => addFace(`PDFE L ${alt}`, b, { weight: bold ? 700 : 400, style: italic ? 'italic' : 'normal' }))
      .catch(() => {}));
  }
  await Promise.all(jobs);
}

// CSS font-family string for a text object (sync; uses whatever is registered already).
export function cssFamily({ font, generic, embedded }, FONTS) {
  const fallback = FONTS[isNamed(font) ? (generic || 'Helvetica') : font] || FONTS.Helvetica;
  if (!isNamed(font)) return fallback;
  const fam = familyOf(font);
  const parts = [];
  if (embedded && embeddedFonts.has(embedded)) parts.push(quote(`PDFE E ${embedded}`));
  parts.push(quote(`PDFE W ${fam}`), quote(fam));
  const alt = lookalikeFor(fam);
  if (alt) parts.push(quote(`PDFE L ${alt}`));
  return `${parts.join(', ')}, ${fallback}`;
}

// ---- Fonts embedded in the open PDF ------------------------------------------------------------
const embeddedFonts = new Map(); // key -> { bytes, bold, italic, chars:Set<number> }

function hashBytes(b) {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return `${(h >>> 0).toString(36)}${b.length.toString(36)}`;
}

// Registers a pdf.js font object's program. Returns its key, or null if unusable.
export function registerEmbedded(fontObj) {
  const data = fontObj?.data;
  if (!data || fontObj.isType3Font || fontObj.missingFile) return null;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const k = hashBytes(bytes);
  if (!embeddedFonts.has(k)) {
    let chars;
    try { chars = new Set(fontkit.create(bytes).characterSet); } catch { return null; }
    embeddedFonts.set(k, { bytes, bold: !!(fontObj.bold || fontObj.black), italic: !!fontObj.italic, chars });
    addFace(`PDFE E ${k}`, bytes, { weight: fontObj.bold || fontObj.black ? 700 : 400, style: fontObj.italic ? 'italic' : 'normal' });
  }
  return k;
}
export const embeddedFont = (k) => embeddedFonts.get(k) || null;

// True when every (non-space) character of text is in the embedded font.
export function embeddedCovers(k, text) {
  const f = embeddedFonts.get(k);
  if (!f) return false;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (!f.chars.has(ch.codePointAt(0))) return false;
  }
  return true;
}
export const embeddedReady = (k) => registered.get(`PDFE E ${k}|${embeddedFonts.get(k)?.bold ? 700 : 400}|${embeddedFonts.get(k)?.italic ? 'italic' : 'normal'}`) || Promise.resolve();

// ---- Download (asks first; remembers the answer per family) ---------------------------------------
const declined = new Set();
export async function offerDownload(family, ask) {
  if (!platform.isDesktop || declined.has(key(family))) return false;
  const settings = await platform.storeGet('fonts', {});
  if (settings.never) return false;
  const answer = settings.always ? 'yes' : await ask(family);
  if (answer === 'never') { await platform.storeSet('fonts', { ...settings, never: true }); return false; }
  if (answer === 'always') await platform.storeSet('fonts', { ...settings, always: true, never: false });
  if (answer !== 'yes' && answer !== 'always') { declined.add(key(family)); return false; } // "Not now" / ignored: this session only
  const r = await platform.downloadFont(family);
  if (r?.ok) await refreshSystemFonts();
  return r;
}
