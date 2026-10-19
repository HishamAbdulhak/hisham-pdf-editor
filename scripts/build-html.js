// Packs the built app (out/) into ONE self-contained HTML file:
//   dist/Hishams-PDF-Editor.html
// Every script, font and data file is embedded, so it works offline straight from disk.
const fs = require('fs');
const path = require('path');
const { ASSETS } = require('./build.js');

const root = path.join(__dirname, '..');
const out = path.join(root, 'out');
const dist = path.join(root, 'dist');

// Text that would end a <script> block early (or confuse the HTML parser) must be base64-encoded.
const unsafe = /<!--|<script|<\/script/i;

function assetTag(name, buf) {
  const isText = /\.(m?js)$/.test(name) && !unsafe.test(buf.toString('utf8'));
  const body = isText ? buf.toString('utf8') : buf.toString('base64');
  return `<script type="text/plain" data-asset="${name}"${isText ? '' : ' data-encoding="base64"'}>${body}</script>`;
}

let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const css = ['pdfjs-layers.css', 'styles.css'].map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
const appJs = fs.readFileSync(path.join(out, 'app.js'));
const assets = Object.keys(ASSETS).map((name) => assetTag(name, fs.readFileSync(path.join(out, 'assets', name)))).join('\n');

const loader = `<script type="text/plain" data-asset="app.js" data-encoding="base64">${appJs.toString('base64')}</script>
<script type="module">
  const el = document.querySelector('script[data-asset="app.js"]');
  const bin = atob(el.textContent.trim());
  el.remove();
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  import(URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' })));
</script>`;

const csp = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; worker-src blob:; connect-src blob: data:; form-action 'none'; base-uri 'none'";

html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('<link rel="stylesheet" href="pdfjs-layers.css">\n', '')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `${assets}\n${loader}`);

fs.mkdirSync(dist, { recursive: true });
const file = path.join(dist, 'Hishams-PDF-Editor.html');
fs.writeFileSync(file, html);
console.log(`wrote ${path.relative(root, file)} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
