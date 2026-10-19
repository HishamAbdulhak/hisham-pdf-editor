// Generates test/sample.pdf: text, an embedded image, a coloured box and a rotated page.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('@cantoo/pdf-lib');
const { png } = require('./png');

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  page.drawText('Quarterly Report', { x: 72, y: 700, size: 28, font: bold, color: rgb(0.1, 0.2, 0.5) });
  page.drawText('Prepared by: John Smith', { x: 72, y: 670, size: 14, font });
  page.drawText('This paragraph is set in Times Roman and can be edited by clicking it.', { x: 72, y: 640, size: 12, font: times });
  page.drawRectangle({ x: 72, y: 560, width: 468, height: 50, color: rgb(0.93, 0.95, 1) });
  page.drawText('Text on a tinted background', { x: 90, y: 580, size: 16, font, color: rgb(0.2, 0.2, 0.2) });
  const w = 200, h = 120;
  const img = await doc.embedPng(png(w, h, (x, y) => [Math.round(255 * x / w), Math.round(255 * y / h), 160, 255]));
  page.drawImage(img, { x: 72, y: 380, width: 240, height: 144 });
  page.drawText('Signature: ______________________', { x: 72, y: 200, size: 14, font });
  // A paragraph (several lines) for paragraph editing and search tests.
  const para = ['Our results this quarter were strong across all regions, with', 'revenue growing twelve percent compared with last year. The', 'team will focus on customer support and faster delivery next.'];
  para.forEach((line, i) => page.drawText(line, { x: 330, y: 500 - i * 15, size: 9, font }));
  // A small fillable form.
  const form = doc.getForm();
  page.drawText('Name:', { x: 72, y: 150, size: 12, font });
  const name = form.createTextField('name');
  name.addToPage(page, { x: 130, y: 142, width: 200, height: 22 });
  page.drawText('Agree:', { x: 360, y: 150, size: 12, font });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 410, y: 144, width: 16, height: 16 });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Page two (rotated 90 degrees)', { x: 72, y: 700, size: 20, font: bold });
  p2.setRotation(degrees(90));
  fs.writeFileSync(path.join(__dirname, '..', 'test', 'sample.pdf'), await doc.save());
  console.log('wrote test/sample.pdf');
})();
