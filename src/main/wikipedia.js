// Wikipedia access (REST + Action API) for any language edition.
// Articles not downloaded by the user are kept in memory only, for the current session.
import path from 'node:path';
import { validId, checkLang, pagesDir, pageKey, titleKey, readJson } from './paths.js';
import { httpFetch } from './http.js';

// Wikimedia asks API clients to identify themselves with a contact URL.
export const USER_AGENT = 'WikiTree/1.1 (https://github.com/boraned/wikitree)';

const wikiBase = (lang) => `https://${checkLang(lang)}.wikipedia.org`;
const absUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || null);

async function wikiFetch(url) {
  try {
    return await httpFetch(url, {
      headers: { 'user-agent': USER_AGENT, 'api-user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('No internet connection');
  }
}

// ---------- in-memory article cache (this session only) ----------
const MEMORY_LIMIT = 32 * 1024 * 1024; // characters of HTML kept for back/forward and re-opening
const articles = new Map();            // key → { title, lang, html }, oldest first
let memoryUsed = 0;

function remember(key, value) {
  if (articles.has(key)) memoryUsed -= articles.get(key).html.length;
  articles.delete(key);
  articles.set(key, value);
  memoryUsed += value.html.length;
  for (const [k, v] of articles) {
    if (memoryUsed <= MEMORY_LIMIT || k === key) break;
    articles.delete(k);
    memoryUsed -= v.html.length;
  }
}
function recall(key) {
  const v = articles.get(key);
  if (v) { articles.delete(key); articles.set(key, v); } // most recently used goes last
  return v;
}

export async function search({ q, lang }) {
  const r = await wikiFetch(`${wikiBase(lang)}/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  return j.pages.map((p) => ({ title: p.title, description: p.description || '', thumb: absUrl(p.thumbnail?.url) }));
}

export async function summary({ title, lang }) {
  const r = await wikiFetch(`${wikiBase(lang)}/api/rest_v1/page/summary/${encodeURIComponent(titleKey(title))}`);
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) throw new Error(`Summary failed (${r.status})`);
  const j = await r.json();
  return {
    title: j.titles?.canonical?.replace(/_/g, ' ') || j.title,
    description: j.description || '',
    extract: j.extract || '',
    thumb: j.thumbnail?.source || null,
  };
}

/** Article HTML: the project's download if there is one, otherwise memory, otherwise Wikipedia. */
export async function page({ title, lang, projectId }) {
  checkLang(lang);
  if (validId(projectId)) {
    const saved = await readJson(path.join(pagesDir(projectId), `${pageKey(lang, title)}.json`));
    if (saved) return { ...saved, saved: true };
  }
  const key = pageKey(lang, title);
  const known = recall(key);
  if (known) return known;

  const r = await wikiFetch(`${wikiBase(lang)}/w/rest.php/v1/page/${encodeURIComponent(titleKey(title))}/html`);
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) throw new Error(`Page failed (${r.status})`);
  const html = await r.text();
  // Redirects are followed; the page names its canonical title in <link rel="dc:isVersionOf">.
  const m = html.match(/<link rel="dc:isVersionOf" href="[^"]*\/wiki\/([^"]+)"/);
  const result = { title: m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : title, lang, html };
  remember(key, result);
  return result;
}

/** Namespace prefixes ("File:", "Dosya:", "Kategorie:") so links to non-articles are dropped in any language. */
const namespaceLists = new Map();
export async function namespaces(lang) {
  checkLang(lang);
  if (namespaceLists.has(lang)) return namespaceLists.get(lang);
  try {
    const r = await wikiFetch(`${wikiBase(lang)}/w/api.php?action=query&meta=siteinfo&siprop=namespaces%7Cnamespacealiases&format=json&formatversion=2`);
    if (!r.ok) throw new Error();
    const j = await r.json();
    const names = new Set();
    for (const ns of Object.values(j.query.namespaces)) {
      if (ns.id === 0) continue;
      for (const n of [ns.name, ns.canonical]) if (n) names.add(n.toLowerCase());
    }
    for (const a of j.query.namespacealiases || []) if (a.id !== 0) names.add(a.alias.toLowerCase());
    const list = [...names];
    namespaceLists.set(lang, list);
    return list;
  } catch {
    return [];
  }
}
