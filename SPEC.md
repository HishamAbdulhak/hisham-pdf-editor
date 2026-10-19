# Hisham's PDF Editor — agreed spec

Free, offline PDF editor shared among friends. Decisions settled in the design
interview; this file is the reference for the build.

## Distribution
- Windows **.exe**, two builds: **portable** (single file) and **installer**
  (Start menu + desktop shortcut, uninstaller, "Open with" for PDFs).
- The **single HTML file** is built from the same code (for Mac or anyone who
  can't run an .exe). Must work in Chrome, Edge and Firefox; Safari is a bonus.
- Unsigned: include a short "how to open it" note (SmartScreen: *More info →
  Run anyway*).
- Shared manually (Drive, WhatsApp). No auto-update; **the app never goes online**.
- In-app "Set as default PDF app" button that opens the Windows setting.
- Icon: blue page with an "H" and a pen nib. Blue brand colour.
- Computers only (no phone layout).

## Documents and tabs
- Several PDFs open at once in **tabs**. Opening a PDF (double-click, drag-in,
  Open) always uses a new tab, or switches to it if it's already open.
- On restart, the PDFs that were open reopen.
- **Autosave/recovery:** unsaved edits are kept; reopening a PDF offers
  "Restore your unsaved edits?"

## Saving
- **Save (Ctrl+S):** Windows save dialog the first time, pre-filled with the
  original file name; after that it saves quietly to the same file.
- **Save As:** always opens the dialog.
- HTML version: asks for a file name (pre-filled with the original) and downloads.

## Viewing
- Search (Ctrl+F), select and copy text, print, table-of-contents panel
  (the PDF's own bookmarks), thumbnails.
- App theme follows Windows (light/dark). A separate **page night mode** toggle
  (dark pages, light text, photos in normal colours), screen only, off by default.
- Speed targets: app opens < 2 s; a 300-page PDF opens < 3 s and scrolls smoothly;
  tools respond instantly. Measured before shipping.

## Editing
- Edit existing text: click to retype. **Paragraph editing**: a paragraph is one
  block that rewraps inside its original width; line-by-line editing as a fallback.
  Originals are covered (not removed).
- Existing images: click to move, resize or delete.
- Add text boxes, images, freehand pen, highlighter, box, circle, line, arrow,
  whiteout, eraser. Undo/redo, copy/paste, keyboard shortcuts.
- Text markup on selected text: **highlight, underline, strikethrough**.
- **Sticky-note comments** and **stamps** (Approved, Draft, Confidential, Paid,
  plus today's date).
- **Signatures**: draw, type, upload; saved for reuse.
- **Fill forms**: type into a PDF's own fields and tick its checkboxes.
- **Redact**: draw boxes; the page is flattened into an image with black boxes
  burned in, then OCR'd automatically so it's searchable again.

## Arabic
- Arabic as real text (embedded fonts): Naskh (Amiri) and modern (Cairo) styles, right-to-left typing.
  Chosen because their text copies/searches back out cleanly (Noto Arabic splits letters into
  shared shapes, which garbles copied text).
- Editing existing Arabic text by clicking it, with a warning that it may need
  retyping.
- Interface language switch: English / Arabic (RTL layout).

## Pages and file tools
- Rotate, delete, reorder (drag thumbnails), insert blank page, merge another PDF,
  extract pages.
- **Split**: every page, every N pages, or custom ranges. Output: one ZIP (HTML
  version) or a chosen folder (.exe).
- **Page numbers**: `1`, `Page 1 of 10`, `1 / 10`; any position; custom start;
  option to skip the first page.
- **Watermarks**: text or image, with size, angle and opacity.
- **Reduce file size**: recompress images inside the PDF (Low/Medium/High);
  text stays sharp.
- **Images → PDF** and **PDF → images** (PNG/JPG).
- **Passwords**: protect a saved file with a password; open and edit
  password-protected PDFs when the password is known.

## OCR
- English + Arabic, built in (works offline).
- Adds an invisible, selectable/searchable text layer over scanned pages, which
  also makes the Edit tool work on scans.

## Not doing
- PDF → Word, Word → PDF, AI features, phone/tablet layout, code signing,
  auto-update.
