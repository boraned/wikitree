// Web pages: search, page titles, and the rules for showing live sites inside the app.
// Sites run in Chromium iframes (their own sandboxed renderer process, V8 with JavaScript on) in the
// in-memory session, so nothing they load or store survives closing the app.
import { memorySession } from './http.js';
import { checkWebUrl } from './web-url.js';

export { checkWebUrl };

const MAX_HTML = 512 * 1024;
const userAgent = () => memorySession().getUserAgent().replace(/ (Electron|WikiTree|wikitree)\/\S+/gi, '');


const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

async function get(url, init = {}) {
  try {
    return await memorySession().fetch(url, { ...init, headers: { 'user-agent': userAgent(), 'accept-language': 'en-US,en;q=0.9', ...(init.headers || {}) }, signal: AbortSignal.timeout(12000) });
  } catch (e) {
    throw new Error(/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK/.test(e.message) ? 'No internet connection' : e.name === 'TimeoutError' ? 'The page took too long to answer' : e.message);
  }
}

/** DuckDuckGo's HTML results: [{ title, url, snippet, icon }]. Ads are left out. */
export async function search({ q }) {
  const query = String(q || '').trim().slice(0, 500);
  if (!query) return [];
  const response = await get('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query, kl: 'wt-wt' }).toString(),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const html = await response.text();
  if (/anomaly-modal|challenge-form/.test(html)) throw new Error('Search is busy; try again in a moment');
  const results = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/result--ad/.test(block.slice(0, 200))) continue;
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    let url = decode(link[1]);
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) url = decodeURIComponent(redirect[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    try { url = checkWebUrl(url); } catch { continue; }
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({ title: decode(link[2]) || new URL(url).hostname, url, snippet: snippet ? decode(snippet[1]) : '', icon: `https://external-content.duckduckgo.com/ip3/${new URL(url).hostname}.ico` });
    if (results.length >= 20) break;
  }
  return results;
}

/** Title and final address of a page, from the first part of its HTML. */
export async function pageInfo(raw) {
  const url = checkWebUrl(raw);
  const fallback = { url, title: new URL(url).hostname.replace(/^www\./, '') };
  let response;
  try { response = await get(url, { headers: { accept: 'text/html,application/xhtml+xml' } }); } catch { return fallback; }
  const finalUrl = response.url && /^https?:/.test(response.url) ? response.url : url;
  if (!/html/i.test(response.headers.get('content-type') || '')) { response.body?.cancel().catch(() => {}); return { ...fallback, url: finalUrl }; }
  const reader = response.body.getReader();
  let html = '';
  const text = new TextDecoder();
  try {
    while (html.length < MAX_HTML && !/<\/title>/i.test(html)) {
      const { value, done } = await reader.read();
      if (done) break;
      html += text.decode(value, { stream: true });
    }
  } finally { reader.cancel().catch(() => {}); }
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 300);
  return { url: finalUrl, title: title || fallback.title };
}

/**
 * Lets sites appear inside the app's frames: for embedded frames only, drop the headers that forbid framing.
 * Everything else about the page (its origin, cookies, scripts) stays isolated from the app.
 */
export function allowFraming(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || !/^https?:/.test(details.url)) return callback({});
    const headers = {};
    for (const [name, values] of Object.entries(details.responseHeaders || {})) {
      const key = name.toLowerCase();
      if (key === 'x-frame-options') continue;
      if (key === 'content-security-policy') {
        const kept = values.map((v) => v.split(';').filter((d) => !/^\s*frame-ancestors\b/i.test(d)).join(';')).filter((v) => v.trim());
        if (kept.length) headers[name] = kept;
        continue;
      }
      headers[name] = values;
    }
    callback({ responseHeaders: headers });
  });
  // Sites may go fullscreen; camera, microphone, location, notifications and the like are refused.
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}
