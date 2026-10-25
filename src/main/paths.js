// Locations, identifiers and safe file writes shared by the main-process modules.
//
// Everything lives in the OS per-user data folder (override with WIKITREE_HOME):
//   projects/<id>/project.json   the tree — whole-file writes, last writer wins
//   projects/<id>/pages/*.json   downloaded articles (cleaned HTML)
//   projects/<id>/media/*        images used by downloaded articles
//   settings.json                small preferences (last search language)
// Nothing else from Wikipedia is written to disk: see http.js.
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const dirs = { home: '', data: '' };

export async function initDirs(userData) {
  dirs.home = userData;
  dirs.data = path.join(userData, 'projects');
  await fs.mkdir(dirs.data, { recursive: true });
}

/** Left in the data folder by older versions: the article cache and Chromium's session files. */
const LEGACY_CACHES = [
  'cache', 'Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Shared Dictionary', 'Dictionaries', 'Local Storage', 'Session Storage', 'blob_storage', 'Trust Tokens',
  'Trust Tokens-journal', 'Network Persistent State', 'TransportSecurity', 'DIPS', 'DIPS-journal', 'Cookies',
  'Cookies-journal', 'Preferences', 'declarative_performance_observer.db', 'declarative_performance_observer.db-journal',
];
export async function removeLegacyCaches() {
  await Promise.all(LEGACY_CACHES.map((d) => fs.rm(path.join(dirs.home, d), { recursive: true, force: true }).catch(() => {})));
}

// ---------- settings ----------
const settingsFile = () => path.join(dirs.home, 'settings.json');
export function readSettings() {
  try { return JSON.parse(fss.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
export async function writeSetting(key, value) {
  const s = readSettings();
  s[key] = value;
  await writeAtomic(settingsFile(), JSON.stringify(s));
}

// ---------- validation ----------
const LANG_RE = /^[a-z][a-z0-9-]{1,15}$/;
export const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,32}$/.test(id);
export const checkId = (id) => { if (!validId(id)) throw new Error('Bad id'); return id; };
export const checkLang = (l = 'en') => { if (!LANG_RE.test(l)) throw new Error('Bad language'); return l; };

// ---------- paths & keys ----------
export const projectDir = (id) => path.join(dirs.data, checkId(id));
export const projectFile = (id) => path.join(projectDir(id), 'project.json');
export const pagesDir = (id) => path.join(projectDir(id), 'pages');
export const mediaDir = (id) => path.join(projectDir(id), 'media');

export const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const newId = () => crypto.randomBytes(6).toString('hex');
export const titleKey = (t) => String(t).trim().replace(/ /g, '_');
export const pageKey = (lang, title) => sha(`${lang}:${titleKey(title)}`);

// ---------- files ----------
let tmpSeq = 0;
const tmpName = (file) => `${file}.${process.pid}.${++tmpSeq}.tmp`;
const RETRY = ['EPERM', 'EBUSY', 'EACCES'];

/** Atomic replace; retried because Windows can briefly lock files (antivirus, indexer, another window). */
export async function writeAtomic(file, text) {
  const tmp = tmpName(file);
  await fs.writeFile(tmp, text);
  for (let i = 0; ; i++) {
    try { await fs.rename(tmp, file); return; } catch (e) {
      if (i >= 6 || !RETRY.includes(e.code)) { await fs.rm(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
}

export function writeAtomicSync(file, text) {
  const tmp = tmpName(file);
  fss.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fss.renameSync(tmp, file); return; } catch (e) {
      if (i >= 6 || !RETRY.includes(e.code)) { fss.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
  }
}

export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
