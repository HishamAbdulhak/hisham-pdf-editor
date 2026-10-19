// Runtime access to bundled assets (pdf.js worker, fonts, OCR data).
// Desktop app / dev server: plain files under ./assets/.
// Single HTML file: each asset is embedded in a <script type="text/plain" data-asset="name">
// tag (base64 for binary files) and turned into a blob: URL on first use.

const urls = new Map();
const MIME = { mjs: 'text/javascript', js: 'text/javascript', ttf: 'font/ttf', woff2: 'font/woff2', gz: 'application/gzip' };

export const isSingleFile = !!document.querySelector('script[data-asset]');

function embedded(name) {
  return document.querySelector(`script[data-asset="${CSS.escape(name)}"]`);
}

function decode(el) {
  const text = el.textContent;
  if (el.dataset.encoding !== 'base64') return text.replace(/<\\\/script/gi, '</script');
  const bin = atob(text.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// URL usable by fetch / Worker / importScripts.
export function assetUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let url;
  const el = isSingleFile && embedded(name);
  if (el) {
    const ext = name.split('.').pop();
    url = URL.createObjectURL(new Blob([decode(el)], { type: MIME[ext] || 'application/octet-stream' }));
    el.remove(); // free the text copy
  } else {
    url = new URL(`./assets/${name}`, document.baseURI).href;
  }
  urls.set(name, url);
  return url;
}

export async function assetBytes(name) {
  const res = await fetch(assetUrl(name));
  if (!res.ok) throw new Error(`Missing asset ${name}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Options for pdfjsLib.getDocument().
export function pdfjsOptions() {
  if (isSingleFile) return { isEvalSupported: false, useSystemFonts: true, useWorkerFetch: false };
  const dir = (d) => new URL(`./assets/pdfjs/${d}/`, document.baseURI).href;
  return {
    cMapUrl: dir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dir('standard_fonts'),
    wasmUrl: dir('wasm'),
    iccUrl: dir('iccs'),
    isEvalSupported: false,
  };
}
