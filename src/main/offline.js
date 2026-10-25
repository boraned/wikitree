// Offline copies: an article's cleaned HTML plus its images, stored inside the project folder.
import { httpFetch } from './http.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkLang, sha, pageKey, pagesDir, mediaDir, projectFile, writeAtomic } from './paths.js';
import { USER_AGENT } from './wikipedia.js';

export const mediaUrl = (projectId, file) => `wikitree://media/${projectId}/${file}`;

function mediaExt(url, type = '') {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|gif|svg|webp)$/i);
  if (m) return `.${m[1].toLowerCase()}`;
  const t = type.match(/image\/(jpeg|png|gif|svg\+xml|webp)/);
  return t ? `.${{ jpeg: 'jpg', 'svg+xml': 'svg' }[t[1]] || t[1]}` : '.img';
}

/** Downloads each URL once into `dir` (6 at a time). Returns url → file name. */
async function downloadAll(urls, dir, limit = 6) {
  const map = new Map();
  const queue = [...new Set(urls)].filter((u) => /^https:\/\//.test(u));
  const existing = await fs.readdir(dir).catch(() => []);
  let failed = 0;
  async function worker() {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const base = sha(url).slice(0, 24);
      const hit = existing.find((f) => f.startsWith(base));
      if (hit) { map.set(url, hit); continue; }
      try {
        const r = await httpFetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error();
        const file = base + mediaExt(url, r.headers.get('content-type') || '');
        await fs.writeFile(path.join(dir, file), Buffer.from(await r.arrayBuffer()));
        map.set(url, file);
      } catch { failed++; }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return { map, failed };
}

export async function savePage({ projectId, lang, title, html, images, thumb, dir }) {
  checkLang(lang);
  await fs.mkdir(pagesDir(projectId), { recursive: true });
  await fs.mkdir(mediaDir(projectId), { recursive: true });
  const { map, failed } = await downloadAll([...(images || []), thumb].filter(Boolean), mediaDir(projectId));
  let out = String(html);
  for (const [url, file] of map) {
    const local = mediaUrl(projectId, file);
    out = out.split(url).join(local).split(url.replace(/&/g, '&amp;')).join(local);
  }
  const record = { title, lang, dir: dir === 'rtl' ? 'rtl' : 'ltr', html: out, cleaned: true, savedAt: Date.now() };
  await writeAtomic(path.join(pagesDir(projectId), `${pageKey(lang, title)}.json`), JSON.stringify(record));
  return { thumbLocal: thumb && map.has(thumb) ? mediaUrl(projectId, map.get(thumb)) : null, failed };
}

export async function removePage({ projectId, lang, title }) {
  await fs.rm(path.join(pagesDir(projectId), `${pageKey(checkLang(lang), title)}.json`), { force: true });
  await collectMedia(projectId);
  return { ok: true };
}

export async function savedState({ projectId, items }) {
  return Promise.all((items || []).map(({ lang, title }) =>
    fs.access(path.join(pagesDir(projectId), `${pageKey(checkLang(lang), title)}.json`)).then(() => true, () => false)));
}

/** Deletes media no longer referenced by any saved page or by the project file. */
async function collectMedia(projectId) {
  const dir = mediaDir(projectId);
  const files = await fs.readdir(dir).catch(() => []);
  if (!files.length) return;
  const used = new Set();
  const re = new RegExp(`wikitree://media/${projectId}/([\\w.]+)`, 'g');
  const scan = (text) => { for (const m of text.matchAll(re)) used.add(m[1]); };
  scan(await fs.readFile(projectFile(projectId), 'utf8').catch(() => ''));
  for (const f of await fs.readdir(pagesDir(projectId)).catch(() => [])) {
    scan(await fs.readFile(path.join(pagesDir(projectId), f), 'utf8').catch(() => ''));
  }
  await Promise.all(files.filter((f) => !used.has(f)).map((f) => fs.rm(path.join(dir, f), { force: true })));
}
