// Size cap for the recently-opened-articles cache (cache/pages). Saved articles live in the
// project folders and are never touched here.
//
// "Last used" is the file's access time, set explicitly on every read (mount options like
// relatime/noatime don't affect explicit updates). Modification time still means "fetched at",
// which is what the freshness check uses.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dirs } from './paths.js';

const MB = 1024 * 1024;
export const LIMIT = (Number(process.env.WIKITREE_CACHE_MB) || 200) * MB;
const TARGET = 0.8; // after pruning, drop to 80% so it doesn't prune on every write

const pagesCache = () => path.join(dirs.cache, 'pages');

/** Marks a cached article as just used, keeping its fetch time. */
export async function touch(file) {
  try {
    const st = await fs.stat(file);
    await fs.utimes(file, new Date(), st.mtime);
  } catch { /* gone — nothing to do */ }
}

let running = null;
let again = false;

/** Deletes least-recently-used articles while the cache is over LIMIT. `keep` is never deleted. */
export function prune(keep) {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const dir = pagesCache();
      const files = [];
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const file = path.join(dir, name);
        try {
          const st = await fs.stat(file);
          if (st.isFile()) files.push({ file, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) });
        } catch { /* removed meanwhile */ }
      }
      let total = files.reduce((s, f) => s + f.size, 0);
      if (total <= LIMIT) return;
      files.sort((a, b) => a.used - b.used);
      for (const f of files) {
        if (total <= LIMIT * TARGET) break;
        if (f.file === keep) continue;
        await fs.rm(f.file, { force: true });
        total -= f.size;
      }
    } finally {
      running = null;
      if (again) { again = false; prune(keep); }
    }
  })();
  return running;
}
