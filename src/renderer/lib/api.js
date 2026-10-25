// Renderer-side API: everything goes through the Electron preload bridge.
export const api = window.wikitree;

export const LANGS = [
  ['en', 'English'], ['tr', 'Türkçe'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'],
  ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'],
  ['no', 'Norsk'], ['da', 'Dansk'], ['fi', 'Suomi'], ['cs', 'Čeština'], ['hu', 'Magyar'],
  ['ro', 'Română'], ['el', 'Ελληνικά'], ['ru', 'Русский'], ['uk', 'Українська'], ['az', 'Azərbaycanca'],
  ['ar', 'العربية'], ['fa', 'فارسی'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'],
  ['vi', 'Tiếng Việt'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['ca', 'Català'],
];

export const getLang = () => localStorage.getItem('wt-lang') || 'en';
export const setLang = (l) => localStorage.setItem('wt-lang', l);

export const isOffline = (e) => !navigator.onLine || /internet/i.test(e?.message || '');

// Summaries are reused by link previews and node creation.
const summaryCache = new Map();
export function cachedSummary(title, lang = 'en') {
  const k = `${lang}:${title.toLowerCase()}`;
  if (!summaryCache.has(k)) {
    const p = api.summary(title, lang).catch((e) => { summaryCache.delete(k); throw e; });
    summaryCache.set(k, p);
  }
  return summaryCache.get(k);
}

let errTimer;
export function showError(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(errTimer);
  errTimer = setTimeout(() => (el.hidden = true), 4000);
}
