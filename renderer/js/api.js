// Renderer-side API: everything goes through the Electron preload bridge.
export const api = window.wikitree;

// Summaries are reused by link previews and node creation.
const summaryCache = new Map();
export function cachedSummary(title) {
  const k = title.toLowerCase();
  if (!summaryCache.has(k)) {
    const p = api.summary(title).catch((e) => { summaryCache.delete(k); throw e; });
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
