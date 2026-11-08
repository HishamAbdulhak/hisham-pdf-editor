// Generates test/fonts.pdf: text in real embedded fonts (subsets), for the font-keeping tests.
// Usage: node scripts/make-fonts-sample.js <calibri.ttf> <arialbd.ttf> <Lato-Regular.ttf>
// (Calibri/Arial ship with Windows; Lato is from Google Fonts and is deliberately NOT installed.)
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('@cantoo/pdf-lib');
const fontkit = require('@cantoo/fontkit');

(async () => {
  // src/ is ES modules while this package is CommonJS, so load it as a data: module.
  const sfntSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'sfnt.js'), 'utf8');
  const { stripBitmapTables } = await import(`data:text/javascript,${encodeURIComponent(sfntSrc)}`);
  const [calibri, arialBold, lato] = process.argv.slice(2).map((p) => stripBitmapTables(fs.readFileSync(p)));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([612, 792]);
  const fCal = await doc.embedFont(calibri, { subset: true });
  const fArial = await doc.embedFont(arialBold, { subset: true });
  const fLato = await doc.embedFont(lato, { subset: true });
  page.drawText('Quarterly sales grew in every region', { x: 72, y: 700, size: 16, font: fCal, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Prepared by the finance team', { x: 72, y: 660, size: 14, font: fArial });
  page.drawText('Lato is not installed here', { x: 72, y: 620, size: 14, font: fLato });
  fs.writeFileSync(path.join(__dirname, '..', 'test', 'fonts.pdf'), await doc.save());
  console.log('wrote test/fonts.pdf');
})();
