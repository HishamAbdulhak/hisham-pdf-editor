// Document tabs: each tab owns an Editor and its own scrolling page area.
import { Editor, newId } from './editor.js';
import { icons } from './ui.js';
import { t } from './i18n.js';

export class Tabs {
  constructor({ bar, views, shared, onEditorChange, onActivate, onCloseClick, onNewClick }) {
    Object.assign(this, { bar, views, shared, onEditorChange, onActivate, onCloseClick, onNewClick });
    this.list = [];
    this.active = null;
  }

  add() {
    const scroller = document.createElement('section');
    scroller.className = 'scroller';
    scroller.hidden = true;
    scroller.tabIndex = -1;
    const pages = document.createElement('div');
    pages.className = 'pages';
    scroller.appendChild(pages);
    this.views.appendChild(scroller);
    const tab = { id: newId('tab'), scroller, pages };
    tab.editor = new Editor({ scroller, pagesEl: pages, shared: this.shared, onChange: (what, arg) => this.onEditorChange(tab, what, arg) });
    this.list.push(tab);
    this.render();
    return tab;
  }

  activate(tab) {
    if (!tab) { this.active = null; this.render(); this.onActivate(null); return; }
    for (const x of this.list) x.scroller.hidden = x !== tab;
    this.active = tab;
    this.render();
    // A hidden tab can't measure itself; fit it now that it's visible.
    requestAnimationFrame(() => { if (tab.editor.fitMode && tab.editor.hasDoc) tab.editor.fitWidth(); });
    this.onActivate(tab);
  }

  remove(tab) {
    const i = this.list.indexOf(tab);
    if (i < 0) return;
    tab.editor.destroy();
    tab.scroller.remove();
    this.list.splice(i, 1);
    if (this.active === tab) this.activate(this.list[Math.min(i, this.list.length - 1)] || null);
    else this.render();
  }

  findByPath(p) {
    if (!p) return null;
    const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
    return this.list.find((x) => x.editor.filePath && norm(x.editor.filePath) === norm(p)) || null;
  }

  render() {
    this.bar.innerHTML = '';
    this.bar.hidden = !this.list.length;
    for (const tab of this.list) {
      const el = document.createElement('div');
      el.className = `tab${tab === this.active ? ' on' : ''}`;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', tab === this.active);
      const name = tab.editor.fileName || t('Untitled');
      el.title = tab.editor.filePath || name;
      el.innerHTML = `${icons.file}<span class="tab-name"></span><span class="tab-dirty" title="${t('Unsaved changes')}"></span>${tab.editor.protect ? `<span class="tab-lock" title="${t('Password protected')}">${icons.lock}</span>` : ''}<button class="tab-close" title="${t('Close tab')} (Ctrl+W)">${icons.close}</button>`;
      el.querySelector('.tab-name').textContent = name;
      el.classList.toggle('dirty', tab.editor.hasDoc && tab.editor.dirty);
      el.onclick = (e) => { if (!e.target.closest('.tab-close')) this.activate(tab); };
      el.onauxclick = (e) => { if (e.button === 1) this.onCloseClick(tab); };
      el.querySelector('.tab-close').onclick = () => this.onCloseClick(tab);
      this.bar.appendChild(el);
    }
    const plus = document.createElement('button');
    plus.className = 'tab-new';
    plus.title = t('Open PDF');
    plus.innerHTML = icons.plus;
    plus.onclick = () => this.onNewClick();
    this.bar.appendChild(plus);
  }
}
