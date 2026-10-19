// Signature dialog: draw, type or upload a signature; saved ones can be reused.
import { modal, icons } from './ui.js';
import { platform, fileToDataUrl } from './platform.js';
import { t } from './i18n.js';

const SCRIPT_FONTS = [
  { label: 'Elegant', css: '"Great Vibes", "PDFE Naskh"' },
  { label: 'Casual', css: '"Dancing Script", "PDFE ArSans"' },
  { label: 'Classic', css: '"Times New Roman", serif', style: 'italic' },
];
const INKS = ['#111827', '#1d3fbf', '#b42318'];

export async function chooseSignature() {
  let saved = await platform.storeGet('signatures', []);
  return modal({
    title: t('Add signature'),
    width: 620,
    build(body, close) {
      body.innerHTML = `
        <div class="sig-saved" hidden><div class="sig-saved-title">${t('Saved signatures')}</div><div class="sig-saved-list"></div></div>
        <div class="tabs"><button data-tab="draw" class="on">${t('Draw')}</button><button data-tab="type">${t('Type')}</button><button data-tab="upload">${t('Upload image')}</button></div>
        <div class="tab-pane" data-pane="draw">
          <canvas class="sig-pad" width="1120" height="360"></canvas>
          <div class="sig-row"><div class="inks"></div><button class="btn" data-clear>${t('Clear')}</button></div>
        </div>
        <div class="tab-pane" data-pane="type" hidden>
          <input class="sig-name" placeholder="${t('Type your name')}" maxlength="60">
          <div class="sig-fonts"></div>
          <div class="sig-row"><div class="inks"></div></div>
        </div>
        <div class="tab-pane" data-pane="upload" hidden>
          <label class="drop-small"><input type="file" accept="image/*" hidden><span>${t('Choose a photo or scan of your signature')}</span></label>
          <img class="sig-preview" hidden alt="">
          <label class="check"><input type="checkbox" data-knock checked> ${t('Remove white background')}</label>
        </div>
        <div class="modal-actions">
          <label class="check"><input type="checkbox" data-save checked> ${t('Save for next time')}</label>
          <span class="spacer"></span>
          <button class="btn" data-cancel>${t('Cancel')}</button><button class="btn primary" data-ok>${t('Place signature')}</button>
        </div>`;

      let tab = 'draw';
      let ink = INKS[0];
      let fontIdx = 0;
      let uploaded = null;

      // Saved list
      const savedWrap = body.querySelector('.sig-saved');
      const renderSaved = () => {
        const list = body.querySelector('.sig-saved-list');
        list.innerHTML = '';
        savedWrap.hidden = !saved.length;
        saved.forEach((url, i) => {
          const item = document.createElement('div');
          item.className = 'sig-item';
          item.innerHTML = `<img alt="${t('Saved signature')}"><button class="icon-btn mini" title="${t('Remove')}">${icons.close}</button>`;
          item.querySelector('img').src = url;
          item.querySelector('img').onclick = () => close(url);
          item.querySelector('button').onclick = async () => {
            saved = saved.filter((_, j) => j !== i);
            await platform.storeSet('signatures', saved);
            renderSaved();
          };
          list.appendChild(item);
        });
      };
      renderSaved();

      // Tabs
      body.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => {
          tab = b.dataset.tab;
          body.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
          body.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
          if (tab === 'type') body.querySelector('.sig-name').focus();
        };
      });

      // Ink colour pickers
      body.querySelectorAll('.inks').forEach((wrap) => {
        INKS.forEach((c) => {
          const b = document.createElement('button');
          b.className = 'swatch';
          b.style.background = c;
          b.title = t('Ink colour');
          b.onclick = () => {
            ink = c;
            body.querySelectorAll('.inks .swatch').forEach((s) => s.classList.toggle('on', s.style.background === b.style.background));
            recolorPad();
            renderFonts();
          };
          if (c === ink) b.classList.add('on');
          wrap.appendChild(b);
        });
      });

      // Draw pad
      const pad = body.querySelector('.sig-pad');
      const pctx = pad.getContext('2d');
      let strokes = [];
      let current = null;
      const redraw = () => {
        pctx.clearRect(0, 0, pad.width, pad.height);
        pctx.strokeStyle = ink;
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';
        for (const s of strokes) {
          if (!s.length) continue;
          pctx.beginPath();
          pctx.moveTo(s[0].x, s[0].y);
          for (let i = 1; i < s.length - 1; i++) {
            const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2;
            pctx.lineWidth = s[i].w;
            pctx.quadraticCurveTo(s[i].x, s[i].y, mx, my);
          }
          const last = s[s.length - 1];
          pctx.lineTo(last.x, last.y);
          pctx.stroke();
        }
      };
      const recolorPad = () => redraw();
      const pos = (e) => {
        const r = pad.getBoundingClientRect();
        return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
      };
      pad.addEventListener('pointerdown', (e) => {
        pad.setPointerCapture(e.pointerId);
        current = [{ ...pos(e), w: 5 }];
        strokes.push(current);
      });
      pad.addEventListener('pointermove', (e) => {
        if (!current) return;
        const p = pos(e);
        const prev = current[current.length - 1];
        const speed = Math.hypot(p.x - prev.x, p.y - prev.y);
        current.push({ ...p, w: Math.max(2.5, Math.min(7, 8 - speed * 0.12)) });
        redraw();
      });
      const end = () => { current = null; };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      body.querySelector('[data-clear]').onclick = () => { strokes = []; redraw(); };

      // Typed
      const nameInput = body.querySelector('.sig-name');
      const fontsWrap = body.querySelector('.sig-fonts');
      const renderFonts = () => {
        fontsWrap.innerHTML = '';
        SCRIPT_FONTS.forEach((f, i) => {
          const b = document.createElement('button');
          b.className = `sig-font${i === fontIdx ? ' on' : ''}`;
          b.style.fontFamily = f.css;
          b.style.fontStyle = f.style || 'normal';
          b.style.color = ink;
          b.textContent = nameInput.value || t('Your Name');
          b.onclick = () => { fontIdx = i; renderFonts(); };
          fontsWrap.appendChild(b);
        });
      };
      nameInput.addEventListener('input', renderFonts);
      renderFonts();

      // Upload
      const fileInput = body.querySelector('input[type=file]');
      const preview = body.querySelector('.sig-preview');
      const knock = body.querySelector('[data-knock]');
      const refreshUpload = async () => {
        if (!uploaded) return;
        preview.src = knock.checked ? await removeWhite(uploaded) : uploaded;
        preview.hidden = false;
      };
      fileInput.onchange = async () => {
        if (!fileInput.files[0]) return;
        uploaded = await fileToDataUrl(fileInput.files[0]);
        refreshUpload();
      };
      knock.onchange = refreshUpload;

      body.querySelector('[data-cancel]').onclick = () => close(null);
      body.querySelector('[data-ok]').onclick = async () => {
        let url = null;
        if (tab === 'draw') {
          if (!strokes.some((s) => s.length > 1)) return;
          url = trim(pad);
        } else if (tab === 'type') {
          if (!nameInput.value.trim()) { nameInput.focus(); return; }
          url = await renderTyped(nameInput.value.trim(), SCRIPT_FONTS[fontIdx], ink);
        } else {
          if (!uploaded) return;
          url = knock.checked ? await removeWhite(uploaded) : uploaded;
        }
        if (body.querySelector('[data-save]').checked && !saved.includes(url)) {
          saved = [url, ...saved].slice(0, 8);
          await platform.storeSet('signatures', saved);
        }
        close(url);
      };
    },
  });
}

// Crops a canvas to its non-transparent pixels and returns a PNG data URL.
function trim(canvas, pad = 8) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return canvas.toDataURL('image/png');
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function renderTyped(text, font, ink) {
  const spec = `${font.style || 'normal'} 140px ${font.css}`;
  try { await document.fonts.load(spec, text); } catch { /* fall back to whatever is available */ }
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = spec;
  c.width = Math.ceil(ctx.measureText(text).width + 80);
  c.height = 260;
  ctx.font = spec;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 40, 130);
  return trim(c);
}

function removeWhite(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        // Fade light pixels out smoothly so edges stay soft.
        if (lum > 215) p[i + 3] = 0;
        else if (lum > 160) p[i + 3] = Math.round(p[i + 3] * (215 - lum) / 55);
      }
      ctx.putImageData(d, 0, 0);
      resolve(trim(c, 4));
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}
