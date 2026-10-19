// Generates test/big.pdf: 300 pages of text with an image every 10 pages (speed testing).
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { png } = require('./png');

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const img = await doc.embedPng(png(400, 300, (x, y) => [x % 256, y % 256, (x * y) % 256, 255]));
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
  for (let p = 0; p < 300; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Chapter ${p + 1}`, { x: 72, y: 720, size: 22, font, color: rgb(0.1, 0.2, 0.5) });
    for (let l = 0; l < 40; l++) {
      const line = Array.from({ length: 12 }, (_, i) => words[(p * 7 + l * 3 + i) % words.length]).join(' ');
      page.drawText(line, { x: 72, y: 690 - l * 15, size: 11, font });
    }
    if (p % 10 === 0) page.drawImage(img, { x: 300, y: 80, width: 240, height: 180 });
  }
  fs.writeFileSync(path.join(__dirname, '..', 'test', 'big.pdf'), await doc.save());
  console.log('wrote test/big.pdf');
})();
