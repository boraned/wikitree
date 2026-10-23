// WikiTree — Electron main process: window, project storage, Wikipedia fetching.
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', 'renderer');
const WIKI = 'https://en.wikipedia.org';
const UA = 'WikiTree/1.0 (desktop app)';
const PAGE_TTL = 3 * 24 * 3600 * 1000;

app.setName('WikiTree');
let DATA, CACHE;

protocol.registerSchemesAsPrivileged([
  { scheme: 'wikitree', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------- storage ----------
const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,32}$/.test(id);
const projectFile = (id) => path.join(DATA, `${id}.json`);
const newId = () => crypto.randomBytes(6).toString('hex');

async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

async function listProjects() {
  const files = (await fs.readdir(DATA)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8'));
      const wikis = Object.values(p.nodes).filter((n) => n.type === 'wiki');
      out.push({
        id: p.id, title: p.title, updated: p.updated,
        count: Object.keys(p.nodes).length - 1,
        thumbs: wikis.filter((n) => n.thumb).slice(0, 4).map((n) => n.thumb),
      });
    } catch { /* skip unreadable file */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

async function createProject(title) {
  const t = String(title || '').trim().slice(0, 120);
  if (!t) throw new Error('Title required');
  const id = newId();
  const rootId = newId();
  const now = Date.now();
  const p = {
    id, title: t, created: now, updated: now, rootId,
    nodes: { [rootId]: { id: rootId, type: 'root', title: t, parent: null, children: [] } },
  };
  await writeAtomic(projectFile(id), JSON.stringify(p, null, 1));
  return p;
}

async function getProject(id) {
  if (!validId(id)) throw new Error('Bad id');
  try { return JSON.parse(await fs.readFile(projectFile(id), 'utf8')); } catch { throw new Error('Project not found'); }
}

async function saveProject(p) {
  if (!p || !validId(p.id) || !p.nodes?.[p.rootId] || p.nodes[p.rootId].type !== 'root') throw new Error('Invalid project');
  p.updated = Date.now();
  p.title = p.nodes[p.rootId].title;
  await writeAtomic(projectFile(p.id), JSON.stringify(p, null, 1));
  return { updated: p.updated };
}

async function deleteProject(id) {
  if (!validId(id)) throw new Error('Bad id');
  await fs.rm(projectFile(id), { force: true });
  return { ok: true };
}

// ---------- wikipedia ----------
const absUrl = (u) => (u && u.startsWith('//') ? `https:${u}` : u || null);
const titleKey = (t) => String(t).trim().replace(/ /g, '_');

async function wikiFetch(url) {
  try {
    return await net.fetch(url, { headers: { 'user-agent': UA, 'api-user-agent': UA } });
  } catch {
    throw new Error('No internet connection');
  }
}

async function wikiSearch(q) {
  const r = await wikiFetch(`${WIKI}/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  return j.pages.map((p) => ({ title: p.title, description: p.description || '', thumb: absUrl(p.thumbnail?.url) }));
}

async function wikiSummary(title) {
  const r = await wikiFetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(titleKey(title))}`);
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) throw new Error(`Summary failed (${r.status})`);
  const j = await r.json();
  return {
    title: j.titles?.canonical?.replace(/_/g, ' ') || j.title,
    description: j.description || '',
    extract: j.extract || '',
    thumb: j.thumbnail?.source || null,
    type: j.type,
  };
}

async function wikiPage(title) {
  const key = titleKey(title);
  const cacheFile = path.join(CACHE, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
  let stale = null;
  try {
    const st = await fs.stat(cacheFile);
    stale = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (Date.now() - st.mtimeMs < PAGE_TTL) return stale;
  } catch { /* cache miss */ }

  let r;
  try {
    r = await wikiFetch(`${WIKI}/w/rest.php/v1/page/${encodeURIComponent(key)}/html`);
  } catch (e) {
    if (stale) return stale; // offline: serve the older copy
    throw e;
  }
  if (r.status === 404) throw new Error('No such page');
  if (!r.ok) {
    if (stale) return stale;
    throw new Error(`Page failed (${r.status})`);
  }
  const html = await r.text();
  // Redirects are followed; the page names its canonical title in <link rel="dc:isVersionOf">.
  const m = html.match(/<link rel="dc:isVersionOf" href="[^"]*\/wiki\/([^"]+)"/);
  const page = { title: m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : title, html };
  await writeAtomic(cacheFile, JSON.stringify(page));
  return page;
}

// ---------- ipc ----------
const handlers = {
  'projects:list': () => listProjects(),
  'projects:create': (title) => createProject(title),
  'projects:get': (id) => getProject(id),
  'projects:save': (p) => saveProject(p),
  'projects:delete': (id) => deleteProject(id),
  'wiki:search': (q) => wikiSearch(q),
  'wiki:summary': (t) => wikiSummary(t),
  'wiki:page': (t) => wikiPage(t),
  'open-external': (url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  },
};

// Errors cross IPC as values so the renderer gets clean messages.
for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(name, async (_e, arg) => {
    try { return { ok: true, value: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}

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
    if (!url.startsWith('wikitree://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('wikitree://app/index.html');
  return win;
}

app.whenReady().then(async () => {
  DATA = path.join(app.getPath('userData'), 'projects');
  CACHE = path.join(app.getPath('cache') || app.getPath('temp'), 'wikitree', 'pages');
  if (process.env.WIKITREE_DATA) DATA = process.env.WIKITREE_DATA;
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(CACHE, { recursive: true });

  protocol.handle('wikitree', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => app.quit());
