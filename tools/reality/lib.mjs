// Shared helpers for the reality-tree tools: polite Wikipedia access with an on-disk cache (so a run can
// resume), canonical title resolution, vital-article levels, and link extraction through the app's own
// article cleaner (so "blue links" are exactly the ones WikiTree's reader shows).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
export const WORK = process.env.REALITY_WORK || path.join(process.env.TMPDIR || '/tmp', 'reality');
const CACHE = path.join(WORK, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const UA = 'WikiTree/1.6 reality-tree builder (https://github.com/boraned/wikitree)';
const API = 'https://en.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- fetching ----------
let active = 0;
const waiting = [];
async function slot(fn) {
  while (active >= 4) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

async function fetchText(url, kind) {
  const file = path.join(CACHE, kind, `${crypto.createHash('sha1').update(url).digest('hex')}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  return slot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': UA, 'api-user-agent': UA }, signal: AbortSignal.timeout(60000) });
        if (r.status === 404) return '';
        if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
        if (!r.ok) return '';
        const text = await r.text();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return text;
      } catch (e) {
        if (attempt >= 6) throw new Error(`${url}: ${e.message}`);
        await sleep(1000 * 2 ** attempt);
      }
    }
  });
}
const api = async (params, kind = 'api') => {
  const text = await fetchText(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, kind);
  return text ? JSON.parse(text) : {};
};

// ---------- titles ----------
const SKIP = [
  /^List of /i, /^Lists of /i, /^Index of /i, /^Glossary of /i, /^Outline of /i, /^Timeline of /i, /^Bibliography of /i,
  /^\d{1,4}s?( BC| BCE| AD| CE)?$/, /^\d{1,2}(st|nd|rd|th) (century|millennium)/i,
  /^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,2})?$/,
  /^ISBN|^ISSN|^Doi|^Digital object identifier/i, /\(disambiguation\)$/,
];
export const skippable = (title) => SKIP.some((re) => re.test(title));

const known = new Map(); // any title → { title, description, thumb } | null (missing / disambiguation)
/** Canonical article data for each title (redirects followed). Unknown, missing and disambiguation pages map to null. */
export async function resolve(titles) {
  const todo = [...new Set(titles.filter((t) => t && !known.has(t)))];
  const batches = [];
  for (let i = 0; i < todo.length; i += 50) batches.push(todo.slice(i, i + 50));
  await Promise.all(batches.map(async (batch) => {
    const j = await api({ action: 'query', redirects: '1', prop: 'pageimages|description|pageprops', piprop: 'thumbnail', pithumbsize: '320', ppprop: 'disambiguation', titles: batch.join('|') }, 'meta');
    const map = new Map(batch.map((t) => [t, t]));
    for (const n of j.query?.normalized || []) for (const [k, v] of map) if (v === n.from) map.set(k, n.to);
    for (const r of j.query?.redirects || []) for (const [k, v] of map) if (v === r.from) map.set(k, r.to);
    const pages = new Map((j.query?.pages || []).map((p) => [p.title, p]));
    for (const [input, canonical] of map) {
      const p = pages.get(canonical);
      known.set(input, !p || p.missing || p.invalid || p.ns !== 0 || p.pageprops?.disambiguation !== undefined ? null
        : { title: p.title, description: p.description || '', thumb: p.thumbnail?.source || null });
    }
  }));
  return titles.map((t) => known.get(t) ?? null);
}

// ---------- vital articles: Wikipedia's own list of "bigger picture" topics ----------
export async function vitalLevels() {
  const file = path.join(WORK, 'vital.json');
  if (fs.existsSync(file)) return new Map(JSON.parse(fs.readFileSync(file, 'utf8')));
  const level = new Map();
  for (let l = 5; l >= 1; l--) {
    const pages = [`Wikipedia:Vital articles/Level ${l}`];
    let cont = {};
    do {
      const j = await api({ action: 'query', list: 'allpages', apnamespace: '4', apprefix: `Vital articles/Level ${l}/`, aplimit: '500', ...cont }, 'vital');
      pages.push(...(j.query?.allpages || []).map((p) => p.title));
      cont = j.continue || null;
    } while (cont);
    for (const page of pages) {
      let lc = {};
      do {
        const j = await api({ action: 'query', prop: 'links', titles: page, plnamespace: '0', pllimit: 'max', ...lc }, 'vital');
        for (const p of j.query?.pages || []) for (const link of p.links || []) level.set(link.title, l);
        lc = j.continue || null;
      } while (lc);
    }
    console.error(`vital level ${l}: ${level.size} titles so far`);
  }
  fs.writeFileSync(file, JSON.stringify([...level]));
  return level;
}

/** Wikipedia's own outgoing blue links and article categories, fetched in batches. */
export async function linkCategories(titles, { canonicalize = true } = {}) {
  const result = new Map();
  const canonical = canonicalize ? await resolve(titles) : titles.map((title) => ({ title }));
  const names = [...new Set(canonical.filter(Boolean).map((p) => p.title))];
  for (const title of names) result.set(title, { links: new Set(), categories: new Set() });
  for (let offset = 0; offset < names.length; offset += 40) {
    const batch = names.slice(offset, offset + 40);
    let cont = {};
    do {
      const j = await api({ action: 'query', prop: 'links|categories', titles: batch.join('|'),
        plnamespace: '0', pllimit: 'max', clshow: '!hidden', cllimit: 'max', ...cont }, 'link-categories');
      for (const page of j.query?.pages || []) {
        const item = result.get(page.title);
        if (!item) continue;
        for (const link of page.links || []) item.links.add(link.title);
        for (const category of page.categories || []) item.categories.add(category.title.replace(/^Category:/, ''));
      }
      cont = j.continue || null;
    } while (cont);
    if (offset && offset % 800 === 0) console.error(`Wikipedia relationship metadata ${Math.min(offset + 40, names.length)}/${names.length}`);
  }
  return result;
}

// ---------- article reading in Chromium with the app's cleaner ----------
let browser;
let opening;
function reader() {
  // One shared page; concurrent first callers wait for the same launch.
  opening ||= (async () => {
    browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const clean = fs.readFileSync(path.join(repo, 'src', 'renderer', 'lib', 'clean.js'), 'utf8');
    await page.addScriptTag({ type: 'module', content: `${clean}\nwindow.cleanArticle = cleanArticle;` });
    await page.waitForFunction(() => typeof window.cleanArticle === 'function');
    return page;
  })();
  return opening;
}
let readerUses = 0;
export async function closeReader() { await browser?.close(); opening = null; browser = null; readerUses = 0; }

/** Blue links of an article as WikiTree's reader shows them: ordered, with lead-section and repeat counts. */
export async function articleLinks(title) {
  const html = await fetchText(`https://en.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title.replace(/ /g, '_'))}/html`, 'parsoid');
  if (!html) return [];
  if (readerUses >= 500) await closeReader(); // bound browser lifetime during large crawls
  const p = await reader();
  readerUses++;
  return p.evaluate((raw) => {
    const { html: cleaned } = window.cleanArticle(raw, []);
    const d = new DOMParser().parseFromString(cleaned, 'text/html');
    const lead = d.querySelector('section[data-mw-section-id="0"]') || d.querySelector('section');
    const out = new Map();
    let order = 0;
    for (const a of d.querySelectorAll('a.wl')) {
      const t = a.dataset.title;
      if (!t) continue;
      const e = out.get(t) || { title: t, order: order++, count: 0, lead: false };
      e.count++;
      if (lead && lead.contains(a)) e.lead = true;
      out.set(t, e);
    }
    return [...out.values()];
  }, html);
}

/** First real image on an article page (useful for pages such as People without a summary thumbnail). */
export async function firstPicture(title) {
  const raw = await fetchText(`https://en.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title.replace(/ /g, '_'))}/html`, 'parsoid');
  const match = raw.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
  if (!match) return null;
  const url = match[1].replaceAll('&amp;', '&');
  return url.startsWith('//') ? `https:${url}` : url.startsWith('http') ? url : null;
}

/**
 * The broader concept an article defines itself by: the first links of its opening paragraph that are not in
 * parentheses or italics ("An atom is the smallest unit of ordinary *matter*…"). Up to three, in order.
 */
export async function definingLinks(title) {
  const j = JSON.parse(await fetchText(`${API}?${new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', page: title, prop: 'text', section: '0', redirects: '1', disableeditsection: '1', disablelimitreport: '1' })}`, 'lead') || '{}');
  const html = j.parse?.text;
  if (!html) return [];
  const p = await reader();
  return p.evaluate((raw) => {
    const d = new DOMParser().parseFromString(raw, 'text/html');
    d.querySelectorAll('table, .hatnote, .infobox, .sidebar, .navbox, sup, .reference, style, .shortdescription, figure, .thumb, .IPA, .noprint, .mw-empty-elt, .rt-commentedText, small').forEach((e) => e.remove());
    const found = [];
    for (const para of d.querySelectorAll('.mw-parser-output > p')) {
      if (!para.textContent.trim()) continue;
      let depth = 0;
      const walk = (node, italic) => {
        for (const child of node.childNodes) {
          if (found.length >= 3) return;
          if (child.nodeType === 3) {
            for (const ch of child.textContent) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); }
          } else if (child.nodeType === 1) {
            const tag = child.tagName;
            if (tag === 'A') {
              const href = child.getAttribute('href') || '';
              if (depth === 0 && !italic && href.startsWith('/wiki/') && !child.classList.contains('new')) {
                const t = decodeURIComponent(href.slice(6).split('#')[0]).replace(/_/g, ' ');
                if (!t.includes(':')) found.push(t);
              }
              for (const ch of child.textContent) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); }
            } else walk(child, italic || tag === 'I' || tag === 'EM');
          }
        }
      };
      walk(para, false);
      if (found.length) break;
    }
    return found;
  }, html);
}

/** Appends one tree operation to an ops file. */
export function writer(file, fresh) {
  if (fresh) fs.rmSync(file, { force: true });
  return (op) => fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...op })}\n`);
}
