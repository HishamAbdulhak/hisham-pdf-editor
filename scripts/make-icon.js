// Draws the app icon (blue tile, white page with an "H", pen nib) and writes
// build/icon.png (512px) and build/icon.ico (16–256px). No image libraries needed.
const fs = require('fs');
const path = require('path');
const { png } = require('./png');

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BLUE = hex('#2f6fed'), BLUE_DARK = hex('#1f4fc4'), WHITE = [255, 255, 255], FOLD = hex('#c9d8fb');
const NIB = hex('#ffb020'), TIP = hex('#1d2433');

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// Colour of the icon at (x, y) in 0..1 coordinates, or null for transparent.
function shade(x, y) {
  let c = null;
  if (inRoundRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.2)) {
    const k = y; // vertical gradient
    c = BLUE.map((v, i) => Math.round(v * (1 - k) + BLUE_DARK[i] * k));
  }
  // Page with folded top-right corner
  const px0 = 0.22, px1 = 0.70, py0 = 0.14, py1 = 0.84, f = 0.13;
  if (x >= px0 && x <= px1 && y >= py0 && y <= py1) {
    const cut = x > px1 - f && y < py0 + f && (x - (px1 - f)) + ((py0 + f) - y) > f;
    if (!cut) {
      const fold = x > px1 - f && y < py0 + f;
      c = fold ? FOLD : WHITE;
    }
  }
  // "H"
  const inH = (x >= 0.31 && x <= 0.38 && y >= 0.34 && y <= 0.70)
    || (x >= 0.52 && x <= 0.59 && y >= 0.34 && y <= 0.70)
    || (x >= 0.38 && x <= 0.52 && y >= 0.485 && y <= 0.55);
  if (inH) c = BLUE;
  // Pen: white outline, orange body, dark tip
  const body = distToSegment(x, y, 0.60, 0.86, 0.88, 0.58);
  const tip = distToSegment(x, y, 0.52, 0.94, 0.60, 0.86);
  const tipR = 0.06 * tip.t;
  if (body.d < 0.085 || (tip.d < tipR + 0.025 && tip.t > 0.05)) c = WHITE;
  if (body.d < 0.06) c = NIB;
  if (tip.d < tipR && tip.t > 0.08) c = TIP;
  return c;
}

function render(size) {
  const ss = 4; // supersampling for smooth edges
  return png(size, size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < ss; i++) {
      for (let j = 0; j < ss; j++) {
        const c = shade((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (ss * ss))];
  });
}

const dir = path.join(__dirname, '..', 'build');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), render(512));

// .ico containing PNG images
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s === 256 ? 0 : s;
  header[e + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, ...images]));
console.log('wrote build/icon.png and build/icon.ico');
