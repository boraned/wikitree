// Wikipedia access (REST + Action API) for any language edition, with a short on-disk cache.
import { net } from 'electron';
import path from 'node:path';
import {
  dirs, validId, checkLang, pagesDir, pageKey, titleKey, writeAtomic, readJson, cachedJson,
} from './paths.js';
import { touch, prune } from './cache.js';

// Wikimedia asks API clients to identify themselves with a contact URL.
export const USER_AGENT = 'WikiTree/1.1 (https://github.com/boraned/wikitree)';
const PAGE_TTL = 3 * 24 * 3600 * 1000;
const NS_TTL = 30 * 24 * 3600 * 1000;

const wikiBase = (lang) => `https://${checkLang(lang)}.wikipedia.org`;
const absUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || null);

async function wikiFetch(url) {
  try {
    return await net.fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'api-user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('No internet connection');
  }
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

/** Article HTML. Order: the project's offline copy → fresh cache → network → stale cache. */
export async function page({ title, lang, projectId }) {
  checkLang(lang);
  if (validId(projectId)) {
    const saved = await readJson(path.join(pagesDir(projectId), `${pageKey(lang, title)}.json`));
    if (saved) return { ...saved, saved: true };
  }
  const cacheFile = path.join(dirs.cache, 'pages', `${pageKey(lang, title)}.json`);
  const cached = await cachedJson(cacheFile, PAGE_TTL);
  const fromCache = () => { touch(cacheFile); return cached.value; };
  if (cached.value && cached.fresh) return fromCache();

  let r;
  try {
    r = await wikiFetch(`${wikiBase(lang)}/w/rest.php/v1/page/${encodeURIComponent(titleKey(title))}/html`);
  } catch (e) {
    if (cached.value) return fromCache();
    throw e;
  }
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) {
    if (cached.value) return fromCache();
    throw new Error(`Page failed (${r.status})`);
  }
  const html = await r.text();
  // Redirects are followed; the page names its canonical title in <link rel="dc:isVersionOf">.
  const m = html.match(/<link rel="dc:isVersionOf" href="[^"]*\/wiki\/([^"]+)"/);
  const result = { title: m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : title, lang, html };
  await writeAtomic(cacheFile, JSON.stringify(result)).catch(() => {});
  prune(cacheFile); // keep the cache under its size cap (runs in the background)
  return result;
}

/** Namespace prefixes ("File:", "Dosya:", "Kategorie:") so links to non-articles are dropped in any language. */
export async function namespaces(lang) {
  checkLang(lang);
  const file = path.join(dirs.cache, `ns-${lang}.json`);
  const cached = await cachedJson(file, NS_TTL);
  if (cached.value && cached.fresh) return cached.value;
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
    await writeAtomic(file, JSON.stringify(list)).catch(() => {});
    return list;
  } catch {
    return cached.value || [];
  }
}
