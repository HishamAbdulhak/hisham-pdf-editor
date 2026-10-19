// Interface language. English text is the key; Arabic translations live in ar.js.
import AR from './ar.js';

let lang = 'en';
const listeners = new Set();

export function t(text, vars) {
  let s = (lang === 'ar' && AR[text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  return s;
}

export const getLang = () => lang;

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const fn of listeners) fn(lang);
}

export const onLangChange = (fn) => listeners.add(fn);

// Localised digits are not used: numbers stay Western so page numbers match the PDF.
