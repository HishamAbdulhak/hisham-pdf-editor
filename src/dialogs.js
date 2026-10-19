// Option dialogs for the document tools. Each returns the chosen options, or null.
import { formModal, modal, icons } from './ui.js';
import { t } from './i18n.js';
import { STAMPS } from './editor.js';
import { parseRanges } from './pagetools.js';

const pageCountNote = (n) => t('This document has {n} pages.', { n });

export function askPassword(name, wrong) {
  return formModal({
    title: t('Password required'),
    intro: wrong ? t('That password is not right. Try again.') : t('“{name}” is protected. Enter its password to open it.', { name }),
    okLabel: t('Open'),
    fields: [{ key: 'pw', label: t('Password'), type: 'password', value: '' }],
  }).then((r) => (r ? r.pw : null));
}

export function protectDialog(current) {
  return formModal({
    title: t('Password protection'),
    intro: current
      ? t('This PDF is protected. Change the password, or remove it so anyone can open the file.')
      : t('Anyone opening the saved file will need this password.'),
    okLabel: t('Apply'),
    fields: [
      ...(current ? [{ key: 'mode', type: 'radio', label: t('Protection'), value: 'change', options: [['change', t('Change password')], ['remove', t('Remove password')]] }] : []),
      { key: 'pw', label: t('Password'), type: 'password', value: '', show: (v) => v.mode !== 'remove' },
      { key: 'pw2', label: t('Repeat password'), type: 'password', value: '', show: (v) => v.mode !== 'remove' },
      { key: 'n', type: 'note', label: t('Keep the password somewhere safe: it cannot be recovered.'), show: (v) => v.mode !== 'remove' },
    ],
    validate: (v) => {
      if (v.mode === 'remove') return null;
      if (!v.pw) return t('Enter a password.');
      if (v.pw !== v.pw2) return t('The passwords do not match.');
      return null;
    },
  });
}

export function ocrDialog({ total, suggested }) {
  return formModal({
    title: t('Recognize text (OCR)'),
    intro: suggested.length
      ? t('{n} page(s) look scanned. OCR adds invisible text so you can search, select and edit them.', { n: suggested.length })
      : t('All pages already have text. You can still run OCR on pages that are images of text.'),
    okLabel: t('Recognize text'),
    fields: [
      { key: 'which', type: 'radio', label: t('Pages'), value: suggested.length ? 'scanned' : 'current', options: [
        ...(suggested.length ? [['scanned', t('Scanned pages only ({n})', { n: suggested.length })]] : []),
        ['current', t('Current page')], ['all', t('All pages ({n})', { n: total })], ['range', t('Choose pages')]] },
      { key: 'range', type: 'text', label: t('Pages, e.g. 1-3, 5'), value: '', show: (v) => v.which === 'range' },
      { key: 'langs', type: 'select', label: t('Language'), value: 'eng+ara', options: [['eng+ara', t('English + Arabic')], ['eng', t('English')], ['ara', t('Arabic')]] },
      { key: 'n', type: 'note', label: t('Runs on this computer. Large documents can take a few minutes.') },
    ],
    validate: (v) => { if (v.which === 'range') { try { parseRanges(v.range, total); } catch (e) { return e.message; } } return null; },
  });
}

export function compressDialog() {
  return formModal({
    title: t('Reduce file size'),
    intro: t('Re-compresses the pictures inside the PDF. Text stays sharp.'),
    okLabel: t('Reduce size'),
    fields: [{ key: 'level', type: 'radio', label: t('Quality'), value: 'medium', options: [
      ['low', t('Low — smallest file')], ['medium', t('Medium — recommended')], ['high', t('High — best quality')]] }],
  });
}

export function splitDialog(total) {
  return formModal({
    title: t('Split PDF'),
    intro: pageCountNote(total),
    okLabel: t('Split'),
    fields: [
      { key: 'mode', type: 'radio', label: t('Split into'), value: 'each', options: [['each', t('One file per page')], ['everyN', t('Files of N pages')], ['ranges', t('Custom ranges')]] },
      { key: 'n', type: 'number', label: t('Pages per file'), value: 2, min: 1, max: total, show: (v) => v.mode === 'everyN' },
      { key: 'ranges', type: 'text', label: t('Ranges, one file each, e.g. 1-3, 4-10'), value: '', placeholder: '1-3, 4-10', show: (v) => v.mode === 'ranges' },
    ],
    validate: (v) => {
      if (v.mode !== 'ranges') return null;
      if (!v.ranges.trim()) return t('Enter at least one range.');
      try { v.ranges.split(',').forEach((r) => parseRanges(r, total)); } catch (e) { return e.message; }
      return null;
    },
  });
}

export function extractDialog(total, current) {
  return formModal({
    title: t('Extract pages'),
    intro: t('Saves the chosen pages as a new PDF.'),
    okLabel: t('Save…'),
    fields: [{ key: 'range', type: 'text', label: t('Pages to include (1–{n}), e.g. 1-3, 5', { n: total }), value: `${current + 1}` }],
    validate: (v) => { try { parseRanges(v.range, total); } catch (e) { return e.message; } return null; },
  });
}

export function numbersDialog() {
  return formModal({
    title: t('Page numbers'),
    okLabel: t('Add numbers'),
    fields: [
      { key: 'style', type: 'select', label: t('Style'), value: 'n', options: [['n', '1, 2, 3'], ['pageOfN', t('Page 1 of 10')], ['slash', '1 / 10']] },
      { key: 'position', type: 'select', label: t('Position'), value: 'bottom-center', options: [
        ['bottom-center', t('Bottom centre')], ['bottom-right', t('Bottom right')], ['bottom-left', t('Bottom left')],
        ['top-center', t('Top centre')], ['top-right', t('Top right')], ['top-left', t('Top left')]] },
      { key: 'start', type: 'number', label: t('Start at'), value: 1, min: 0 },
      { key: 'size', type: 'number', label: t('Font size'), value: 11, min: 6, max: 48 },
      { key: 'color', type: 'color', label: t('Colour'), value: '#333333' },
      { key: 'skipFirst', type: 'checkbox', label: t('Don’t number the first page (cover)'), value: false },
    ],
  });
}

export function watermarkDialog() {
  return formModal({
    title: t('Watermark'),
    okLabel: t('Add watermark'),
    fields: [
      { key: 'kind', type: 'radio', label: t('Type'), value: 'text', options: [['text', t('Text')], ['image', t('Image')]] },
      { key: 'text', type: 'text', label: t('Text'), value: t('CONFIDENTIAL'), show: (v) => v.kind === 'text' },
      { key: 'color', type: 'color', label: t('Colour'), value: '#d92d20', show: (v) => v.kind === 'text' },
      { key: 'size', type: 'range', label: t('Size'), value: 60, min: 10, max: 160, show: (v) => v.kind === 'text' },
      { key: 'scale', type: 'range', label: t('Size (% of page)'), value: 50, min: 10, max: 100, show: (v) => v.kind === 'image' },
      { key: 'angle', type: 'range', label: t('Angle'), value: 45, min: -90, max: 90, format: (v) => `${v}°` },
      { key: 'opacity', type: 'range', label: t('Opacity'), value: 20, min: 5, max: 100, format: (v) => `${v}%` },
      { key: 'pages', type: 'radio', label: t('Pages'), value: 'all', options: [['all', t('All pages')], ['current', t('Current page')]] },
      { key: 'n', type: 'note', label: t('You will choose the image after clicking Add.'), show: (v) => v.kind === 'image' },
    ],
    validate: (v) => (v.kind === 'text' && !v.text.trim() ? t('Enter the watermark text.') : null),
  });
}

export function toImagesDialog(total, current) {
  return formModal({
    title: t('Export pages as images'),
    okLabel: t('Export…'),
    fields: [
      { key: 'which', type: 'radio', label: t('Pages'), value: 'current', options: [['current', t('Current page')], ['all', t('All pages ({n})', { n: total })], ['range', t('Choose pages')]] },
      { key: 'range', type: 'text', label: t('Pages, e.g. 1-3, 5'), value: `${current + 1}`, show: (v) => v.which === 'range' },
      { key: 'format', type: 'radio', label: t('Format'), value: 'png', options: [['png', 'PNG'], ['jpg', 'JPG']] },
      { key: 'dpi', type: 'select', label: t('Resolution'), value: '150', options: [['96', t('Screen (96 dpi)')], ['150', t('Standard (150 dpi)')], ['300', t('Print (300 dpi)')]] },
    ],
    validate: (v) => { if (v.which === 'range') { try { parseRanges(v.range, total); } catch (e) { return e.message; } } return null; },
  });
}

export function imagesToPdfDialog(count) {
  return formModal({
    title: t('Create PDF from images'),
    intro: t('{n} image(s) selected, one per page, in the order chosen.', { n: count }),
    okLabel: t('Create PDF'),
    fields: [
      { key: 'size', type: 'radio', label: t('Page size'), value: 'A4', options: [['A4', 'A4'], ['Letter', 'Letter'], ['fit', t('Same as image')]] },
      { key: 'margin', type: 'select', label: t('Margin'), value: '18', options: [['0', t('None')], ['18', t('Small')], ['36', t('Large')]] },
    ],
  });
}

export function stampPicker() {
  return modal({
    title: t('Add stamp'),
    width: 480,
    build(body, close) {
      body.innerHTML = '<div class="stamp-grid"></div><label class="check stamp-date"><input type="checkbox" checked> </label>';
      body.querySelector('.stamp-date').append(t('Include today’s date'));
      const grid = body.querySelector('.stamp-grid');
      for (const [label, color] of Object.entries(STAMPS)) {
        const b = document.createElement('button');
        b.className = 'stamp-btn';
        b.style.color = color;
        b.style.borderColor = color;
        b.textContent = t(label).toUpperCase();
        b.onclick = () => close({ label, date: body.querySelector('input').checked });
        grid.appendChild(b);
      }
    },
  });
}

export function closeDialog(names) {
  return modal({
    title: t('Unsaved changes'),
    build(body, close) {
      body.innerHTML = '<p class="msg"></p><ul class="msg-list"></ul><div class="modal-actions"><button class="btn danger-text" data-discard></button><span class="spacer"></span><button class="btn" data-cancel></button><button class="btn primary" data-save></button></div>';
      body.querySelector('.msg').textContent = names.length === 1
        ? t('Save changes to “{name}” before closing?', { name: names[0] })
        : t('These documents have unsaved changes:');
      if (names.length > 1) for (const n of names) body.querySelector('ul').appendChild(Object.assign(document.createElement('li'), { textContent: n }));
      body.querySelector('[data-discard]').textContent = t('Don’t save');
      body.querySelector('[data-cancel]').textContent = t('Cancel');
      body.querySelector('[data-save]').textContent = names.length > 1 ? t('Save all') : t('Save');
      body.querySelector('[data-discard]').onclick = () => close('discard');
      body.querySelector('[data-cancel]').onclick = () => close(null);
      body.querySelector('[data-save]').onclick = () => close('save');
    },
  });
}

export function noteEditor(anchorRect, text, { onDelete }) {
  return new Promise((resolve) => {
    document.querySelector('.note-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'note-pop';
    pop.innerHTML = `<textarea rows="5"></textarea><div class="note-actions"><button class="icon-btn" data-del title="${t('Delete comment')}">${icons.trash}</button><span class="spacer"></span><button class="btn" data-done>${t('Done')}</button></div>`;
    const ta = pop.querySelector('textarea');
    ta.value = text;
    ta.placeholder = t('Write a comment…');
    document.body.appendChild(pop);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, anchorRect.right + 8))}px`;
    pop.style.top = `${Math.min(window.innerHeight - h - 12, Math.max(12, anchorRect.top))}px`;
    ta.focus();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      pop.remove();
      document.removeEventListener('mousedown', outside, true);
      resolve(value);
    };
    const outside = (e) => { if (!pop.contains(e.target)) finish(ta.value); };
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    pop.querySelector('[data-done]').onclick = () => finish(ta.value);
    pop.querySelector('[data-del]').onclick = () => { finish(null); onDelete(); };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); finish(ta.value); }
      e.stopPropagation();
    });
  });
}
