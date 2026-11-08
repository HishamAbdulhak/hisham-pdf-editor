// Builds everything into dist/: installer, portable exe, single HTML file, friend note.
// The Windows packager runs in a short temp folder (it can't rename folders inside
// virtualised app-data paths, and long paths break its 7-Zip step), then results are copied back.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(os.tmpdir().split(path.sep).slice(0, 6).join(path.sep), 'hpdfe-build');
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

run('node test/prune.test.mjs');
run('node scripts/make-icon.js');
run('node scripts/build.js');
run('node scripts/build-html.js');
fs.rmSync(path.join(tmp, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'cache'), { recursive: true });
run(`npx electron-builder --win "-c.directories.output=${path.join(tmp, 'dist')}"`, { ELECTRON_BUILDER_CACHE: path.join(tmp, 'cache') });
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const f of fs.readdirSync(path.join(tmp, 'dist'))) {
  if (/\.exe$/.test(f) && !f.includes('__uninstaller')) fs.copyFileSync(path.join(tmp, 'dist', f), path.join(dist, f));
}
fs.copyFileSync(path.join(root, 'HOW-TO-OPEN.txt'), path.join(dist, 'HOW-TO-OPEN.txt'));
console.log('\nRelease files in dist/:');
for (const f of fs.readdirSync(dist)) console.log(`  ${f}  ${(fs.statSync(path.join(dist, f)).size / 1048576).toFixed(1)} MB`);
