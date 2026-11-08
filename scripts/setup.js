// One-time setup after `npm install`: npm may skip the install scripts that download
// Electron and esbuild's binary, and build/ (git-ignored) needs the app icon.
// Safe to run again. Run: npm run setup
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const run = (script) => execFileSync(process.execPath, [path.join(root, script)], { stdio: 'inherit', cwd: root });

if (!fs.existsSync(path.join(root, 'node_modules', 'electron', 'path.txt'))) run('node_modules/electron/install.js');
run('node_modules/esbuild/install.js');
if (!fs.existsSync(path.join(root, 'build', 'icon.png'))) run('scripts/make-icon.js');
console.log('setup done: try `npm run build` and `npm test`');
