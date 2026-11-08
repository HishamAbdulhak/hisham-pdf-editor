// Builds the app into out/: bundled JS, HTML, CSS and runtime assets
// (pdf.js worker and data, fonts, OCR engine and language data).
// Used by the Electron app, the dev server and the single-file HTML build.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = path.join(root, 'out');
const watch = process.argv.includes('--watch');

// name in out/assets -> source file
const ASSETS = {
  'pdf.worker.min.mjs': nm('pdfjs-dist/build/pdf.worker.min.mjs'),
  'icon.png': path.join(root, 'build', 'icon.png'),
  'fonts/great-vibes.woff2': nm('@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2'),
  'fonts/dancing-script.woff2': nm('@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff2'),
  'fonts/naskh-400.ttf': nm('@expo-google-fonts/amiri/400Regular/Amiri_400Regular.ttf'),
  'fonts/naskh-700.ttf': nm('@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'),
  'fonts/arsans-400.ttf': nm('@expo-google-fonts/cairo/400Regular/Cairo_400Regular.ttf'),
  'fonts/arsans-700.ttf': nm('@expo-google-fonts/cairo/700Bold/Cairo_700Bold.ttf'),
  'ocr/worker.min.js': nm('tesseract.js/dist/worker.min.js'),
  'ocr/core.wasm.js': nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
  'ocr/eng.traineddata.gz': nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  'ocr/ara.traineddata.gz': nm('@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz'),
};
// Folders only shipped in the desktop app (the single HTML file falls back to system fonts).
const ASSET_DIRS = { 'fonts/lookalike': path.join(root, 'vendor', 'fonts'), 'pdfjs/cmaps': nm('pdfjs-dist/cmaps'), 'pdfjs/standard_fonts': nm('pdfjs-dist/standard_fonts'), 'pdfjs/wasm': nm('pdfjs-dist/wasm'), 'pdfjs/iccs': nm('pdfjs-dist/iccs') };

// Text-selection and form-field styles from pdf.js's viewer stylesheet.
function pdfjsLayerCss() {
  const css = fs.readFileSync(nm('pdfjs-dist/web/pdf_viewer.css'), 'utf8');
  const block = (selector) => {
    const start = css.indexOf(`\n${selector} {`);
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
    }
    throw new Error('selector not found: ' + selector);
  };
  return ['.textLayer', '.annotationLayer'].map(block).join('\n');
}

function copyStatic() {
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['index.html', 'styles.css']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'pdfjs-layers.css'), pdfjsLayerCss());
}

async function build() {
  if (!fs.existsSync(ASSETS['icon.png'])) require('./make-icon.js'); // build/ is git-ignored
  fs.rmSync(out, { recursive: true, force: true });
  copyStatic();
  for (const [name, from] of Object.entries(ASSETS)) {
    const dest = path.join(out, 'assets', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(from, dest);
  }
  for (const [name, from] of Object.entries(ASSET_DIRS)) fs.cpSync(from, path.join(out, 'assets', name), { recursive: true });

  const options = {
    entryPoints: [path.join(root, 'src', 'app.js')],
    outfile: path.join(out, 'app.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: !watch && !process.env.NOMINIFY,
    sourcemap: watch ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'warning',
    logOverride: { 'duplicate-object-key': 'silent' }, // inside fabric's own build
    // Node-only modules that browser builds of these libraries never load.
    external: ['fs', 'path', 'url', 'module', 'zlib', 'stream', 'http', 'https', 'canvas', 'worker_threads', 'child_process', 'os', 'util'],
  };
  if (watch) {
    const ctx = await esbuild.context({
      ...options,
      plugins: [{ name: 'static', setup(b) { b.onEnd(() => { copyStatic(); console.log('rebuilt', new Date().toLocaleTimeString()); }); } }],
    });
    await ctx.watch();
    console.log('watching src/ …');
  } else {
    await esbuild.build(options);
    console.log('built out/');
  }
}

module.exports = { ASSETS, ASSET_DIRS, build };
if (require.main === module) build().catch((e) => { console.error(e); process.exit(1); });
