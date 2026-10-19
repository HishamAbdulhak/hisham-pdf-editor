# Hisham's PDF Editor

A free, offline PDF editor for Windows, plus the same app as a single HTML file
for any computer. Files never leave the computer: nothing is uploaded, and the app
never goes online.

## What you get (in `dist/`)

| File | For |
|---|---|
| `Hishams-PDF-Editor-Setup-1.0.0.exe` | Windows installer: Start menu and desktop shortcuts, "Open with" for PDFs, uninstaller |
| `Hishams-PDF-Editor-Portable-1.0.0.exe` | Windows, no install: double-click and it runs |
| `Hishams-PDF-Editor.html` | Mac, or any computer: open it in Chrome, Edge or Firefox |
| `HOW-TO-OPEN.txt` | Short note to send friends along with the app |

## Features

**Viewing:** tabs for several PDFs, thumbnails, bookmarks, search (Ctrl+F),
select and copy text, print, zoom, page night mode. Open tabs and unsaved edits
come back after closing the app or a crash.

**Editing:** retype existing text (whole paragraphs rewrap; Alt+click edits one
line), move, resize or delete existing images, add text boxes, images, shapes,
lines, arrows, freehand drawing, a marker pen, whiteout, and an eraser.

**Review:** highlight, underline or strike out selected text, add sticky-note
comments, and add stamps (Approved, Draft, Confidential, Paid…).

**Sign and fill:** draw, type or upload signatures (saved for reuse), and fill in
a PDF's own form fields.

**Arabic:** type Arabic as real, searchable text (Amiri and Cairo fonts, right to
left). The interface can switch between English and Arabic.

**Pages:** rotate, delete, reorder (drag thumbnails), insert blank pages, merge
PDFs, split (every page, every N pages or by ranges), extract pages, page numbers,
watermarks (text or image), and converting images to PDF and pages to images.

**Tools:** OCR for scanned pages (English and Arabic, offline), reduce file size,
password protection (open and edit locked PDFs, lock saved files), and
**redaction**, which permanently removes what's under the boxes.

### Good to know
- Editing existing text or deleting an existing image *covers* the original; it
  is still inside the file. To truly remove something, use **Redact**.
- Text in the standard fonts covers Western languages and Arabic. Other scripts
  and emoji are placed as images.

## Development

```
npm install
npm run dev        # browser version at http://localhost:5178
npm start          # desktop app
npm run build      # build out/ (shared by everything)
npm run html       # dist/Hishams-PDF-Editor.html
npm run dist       # Windows installer + portable exe
sh test/run.sh test/t1-core.js   # automated UI test inside the real app
```

On this machine the Windows build has to write to a short temp path (see
`npm run dist:temp`), because the project folder is under a virtualised app
folder where the packager can't rename directories.

See `SPEC.md` for the full list of decisions.
