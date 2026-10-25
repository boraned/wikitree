// WikiTree — Electron main process: window, project storage, Wikipedia fetching, offline saving.
//
// Storage (OS user-data dir: ~/.config/WikiTree, %APPDATA%\WikiTree, ~/Library/Application Support/WikiTree):
//   projects/<id>/project.json   the tree — whole-file writes, last writer wins (each window edits its own copy)
//   projects/<id>/pages/*.json   articles saved for offline reading (already cleaned HTML)
//   projects/<id>/media/*        images referenced by saved articles
//   cache/                       short-lived article cache + per-language namespace lists
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } from 'electron';
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', 'renderer');
const UA = 'WikiTree/1.1 (desktop app)';
const PAGE_TTL = 3 * 24 * 3600 * 1000;
const NS_TTL = 30 * 24 * 3600 * 1000;
const isMac = process.platform === 'darwin';

app.setName('WikiTree');
if (process.env.WIKITREE_HOME) app.setPath('userData', process.env.WIKITREE_HOME); // isolated data dir (tests, portable use)
let DATA, CACHE;

protocol.registerSchemesAsPrivileged([
  { scheme: 'wikitree', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------- paths & validation ----------
const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,32}$/.test(id);
const LANG_RE = /^[a-z][a-z0-9-]{1,15}$/;
const checkId = (id) => { if (!validId(id)) throw new Error('Bad id'); return id; };
const checkLang = (l = 'en') => { if (!LANG_RE.test(l)) throw new Error('Bad language'); return l; };
const projectDir = (id) => path.join(DATA, checkId(id));
const projectFile = (id) => path.join(projectDir(id), 'project.json');
const pagesDir = (id) => path.join(projectDir(id), 'pages');
const mediaDir = (id) => path.join(projectDir(id), 'media');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const titleKey = (t) => String(t).trim().replace(/ /g, '_');
const pageKey = (lang, title) => sha(`${lang}:${titleKey(title)}`);
const wikiBase = (lang) => `https://${checkLang(lang)}.wikipedia.org`;
const newId = () => crypto.randomBytes(6).toString('hex');

let tmpSeq = 0;
const tmpName = (file) => `${file}.${process.pid}.${++tmpSeq}.tmp`;
const RETRY = ['EPERM', 'EBUSY', 'EACCES'];

// Atomic replace; retried because Windows can briefly lock files (antivirus, indexer, another window).
async function writeAtomic(file, text) {
  const tmp = tmpName(file);
  await fs.writeFile(tmp, text);
  for (let i = 0; ; i++) {
    try { await fs.rename(tmp, file); return; } catch (e) {
      if (i >= 6 || !RETRY.includes(e.code)) { await fs.rm(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, 40 * (i + 1)));
    }
  }
}
function writeAtomicSync(file, text) {
  const tmp = tmpName(file);
  fss.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fss.renameSync(tmp, file); return; } catch (e) {
      if (i >= 6 || !RETRY.includes(e.code)) { fss.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
  }
}

// ---------- projects ----------
async function listProjects() {
  const out = [];
  for (const d of await fs.readdir(DATA, { withFileTypes: true })) {
    if (!d.isDirectory() || !validId(d.name)) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(DATA, d.name, 'project.json'), 'utf8'));
      const wikis = Object.values(p.nodes).filter((n) => n.type === 'wiki' && (n.thumbLocal || n.thumb));
      out.push({
        id: p.id, title: p.title, updated: p.updated,
        count: Object.keys(p.nodes).length,
        thumbs: wikis.slice(0, 4).map((n) => n.thumbLocal || n.thumb),
      });
    } catch { /* unreadable project — skip */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

async function createProject(root) {
  const type = root?.type === 'wiki' ? 'wiki' : 'header';
  const title = String(root?.title || '').trim().slice(0, 300);
  if (!title) throw new Error('Title required');
  const id = newId();
  const rootId = newId();
  const now = Date.now();
  const node = { id: rootId, type, title, parent: null, children: [], x: 0, y: 0 };
  if (type === 'wiki') Object.assign(node, { lang: checkLang(root.lang), description: root.description || '', thumb: root.thumb || null });
  const p = { id, title, created: now, updated: now, rootId, nodes: { [rootId]: node } };
  await fs.mkdir(projectDir(id), { recursive: true });
  await writeAtomic(projectFile(id), JSON.stringify(p));
  return p;
}

async function getProject(id) {
  try { return JSON.parse(await fs.readFile(projectFile(id), 'utf8')); } catch { throw new Error('Project not found'); }
}

function serialize(p) {
  const root = p?.nodes?.[p.rootId];
  if (!validId(p?.id) || !root || root.parent != null) throw new Error('Invalid project');
  p.updated = Date.now();
  p.title = root.title;
  return JSON.stringify(p);
}
async function saveProject(p) {
  const text = serialize(p);
  await fs.mkdir(projectDir(p.id), { recursive: true });
  await writeAtomic(projectFile(p.id), text);
  return { updated: p.updated };
}
function saveProjectSync(p) {
  const text = serialize(p);
  fss.mkdirSync(projectDir(p.id), { recursive: true });
  writeAtomicSync(projectFile(p.id), text);
}

async function deleteProject(id) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
  return { ok: true };
}

// v1.0 stored projects as projects/<id>.json; move each into its own folder.
async function migrateLegacy() {
  for (const f of await fs.readdir(DATA)) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !validId(id)) continue;
    try {
      await fs.mkdir(projectDir(id), { recursive: true });
      await fs.access(projectFile(id)).then(
        () => fs.rm(path.join(DATA, f)),            // already migrated by another window
        () => fs.rename(path.join(DATA, f), projectFile(id)),
      );
    } catch (e) { console.error('migrate', f, e.message); }
  }
}

// ---------- wikipedia ----------
const absUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || null);

async function wikiFetch(url) {
  try {
    return await net.fetch(url, { headers: { 'user-agent': UA, 'api-user-agent': UA }, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('No internet connection');
  }
}

async function wikiSearch({ q, lang }) {
  const r = await wikiFetch(`${wikiBase(lang)}/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  return j.pages.map((p) => ({ title: p.title, description: p.description || '', thumb: absUrl(p.thumbnail?.url) }));
}

async function wikiSummary({ title, lang }) {
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

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
async function cachedJson(file, ttl) {
  try {
    const st = await fs.stat(file);
    return { value: await readJson(file), fresh: Date.now() - st.mtimeMs < ttl };
  } catch { return { value: null, fresh: false }; }
}

async function wikiPage({ title, lang, projectId }) {
  checkLang(lang);
  if (validId(projectId)) {
    const saved = await readJson(path.join(pagesDir(projectId), `${pageKey(lang, title)}.json`));
    if (saved) return { ...saved, saved: true };
  }
  const cacheFile = path.join(CACHE, 'pages', `${pageKey(lang, title)}.json`);
  const cached = await cachedJson(cacheFile, PAGE_TTL);
  if (cached.value && cached.fresh) return cached.value;

  let r;
  try {
    r = await wikiFetch(`${wikiBase(lang)}/w/rest.php/v1/page/${encodeURIComponent(titleKey(title))}/html`);
  } catch (e) {
    if (cached.value) return cached.value; // offline: an older copy beats nothing
    throw e;
  }
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) {
    if (cached.value) return cached.value;
    throw new Error(`Page failed (${r.status})`);
  }
  const html = await r.text();
  // Redirects are followed; the page names its canonical title in <link rel="dc:isVersionOf">.
  const m = html.match(/<link rel="dc:isVersionOf" href="[^"]*\/wiki\/([^"]+)"/);
  const page = { title: m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : title, lang, html };
  await writeAtomic(cacheFile, JSON.stringify(page)).catch(() => {});
  return page;
}

// Namespace prefixes ("File:", "Dosya:", "Kategorie:") so links to non-articles are dropped in any language.
async function namespaces(lang) {
  checkLang(lang);
  const file = path.join(CACHE, `ns-${lang}.json`);
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

// ---------- offline saving ----------
function mediaExt(url, type = '') {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|gif|svg|webp)$/i);
  if (m) return `.${m[1].toLowerCase()}`;
  const t = type.match(/image\/(jpeg|png|gif|svg\+xml|webp)/);
  return t ? `.${{ jpeg: 'jpg', 'svg+xml': 'svg' }[t[1]] || t[1]}` : '.img';
}

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
        const r = await net.fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
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

async function savePage({ projectId, lang, title, html, images, thumb, dir }) {
  checkLang(lang);
  await fs.mkdir(pagesDir(projectId), { recursive: true });
  await fs.mkdir(mediaDir(projectId), { recursive: true });
  const { map, failed } = await downloadAll([...(images || []), thumb].filter(Boolean), mediaDir(projectId));
  const local = (file) => `wikitree://media/${projectId}/${file}`;
  let out = String(html);
  for (const [url, file] of map) {
    out = out.split(url).join(local(file)).split(url.replace(/&/g, '&amp;')).join(local(file));
  }
  const page = { title, lang, dir: dir === 'rtl' ? 'rtl' : 'ltr', html: out, cleaned: true, savedAt: Date.now() };
  await writeAtomic(path.join(pagesDir(projectId), `${pageKey(lang, title)}.json`), JSON.stringify(page));
  return { thumbLocal: thumb && map.has(thumb) ? local(map.get(thumb)) : null, failed };
}

async function unsavePage({ projectId, lang, title }) {
  await fs.rm(path.join(pagesDir(projectId), `${pageKey(checkLang(lang), title)}.json`), { force: true });
  await gcMedia(projectId);
  return { ok: true };
}

async function savedState({ projectId, items }) {
  return Promise.all((items || []).map(({ lang, title }) =>
    fs.access(path.join(pagesDir(projectId), `${pageKey(checkLang(lang), title)}.json`)).then(() => true, () => false)));
}

// Deletes media no longer referenced by any saved page or by the project file.
async function gcMedia(projectId) {
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

// ---------- ipc ----------
const handlers = {
  'projects:list': () => listProjects(),
  'projects:create': (root) => createProject(root),
  'projects:get': (id) => getProject(id),
  'projects:save': (p) => saveProject(p),
  'projects:delete': (id) => deleteProject(id),
  'wiki:search': (a) => wikiSearch(a),
  'wiki:summary': (a) => wikiSummary(a),
  'wiki:page': (a) => wikiPage(a),
  'wiki:namespaces': (lang) => namespaces(lang),
  'offline:save': (a) => savePage(a),
  'offline:remove': (a) => unsavePage(a),
  'offline:state': (a) => savedState(a),
  'open-external': (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); },
};
// Errors cross IPC as values so the renderer gets clean messages.
for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, async (_e, arg) => {
    try { return { ok: true, value: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}
// Used while a window closes so the last change is never lost.
ipcMain.on('projects:save-sync', (e, p) => {
  try { saveProjectSync(p); e.returnValue = { ok: true }; } catch (err) { e.returnValue = { ok: false, error: err.message }; }
});

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 720, minHeight: 500,
    title: 'WikiTree',
    backgroundColor: '#1c1c1e',
    icon: path.join(HERE, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Never leave the app: in-window navigation is blocked, external links go to the system browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('wikitree://app/')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('wikitree://app/index.html');
  return win;
}

function serveFile(base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

app.whenReady().then(async () => {
  DATA = path.join(app.getPath('userData'), 'projects');
  CACHE = path.join(app.getPath('userData'), 'cache');
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(path.join(CACHE, 'pages'), { recursive: true });
  await migrateLegacy();

  protocol.handle('wikitree', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname);
    if (u.host === 'media') {
      const [, pid, file] = rel.split('/');
      if (!validId(pid) || !/^[\w.]+$/.test(file || '')) return new Response('Not found', { status: 404 });
      return serveFile(mediaDir(pid), file);
    }
    return serveFile(RENDERER, rel);
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
