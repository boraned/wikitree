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

// The window's storage is in memory only, so the last search language lives in settings.json.
let lang = api.settings().lang || 'en';
export const getLang = () => lang;
export const setLang = (l) => { lang = l; api.setSetting('lang', l).catch(() => {}); };

export const isOffline = (e) => !navigator.onLine || /internet/i.test(e?.message || '');

// ---------- attached files ----------
export const fileUrl = (projectId, file) => api.fileUrl?.(projectId, file) || `wikitree://file/${projectId}/${file}`;
export const DOC_KINDS = ['pdf', 'markdown', 'text', 'code', 'unsupported'];
/** Every attachment has a safe in-app viewer; no file is executed or opened by the OS. */
export const isOpenable = (n) => n?.type === 'wiki' || n?.type === 'file' || n?.type === 'web';
/** Web nodes only ever load http(s) pages: never the app's own origin. */
export const isWebUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

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
