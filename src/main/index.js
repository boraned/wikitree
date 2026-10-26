// WikiTree — Electron main process entry: window, app protocol, menu, IPC.
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initDirs, validId, checkId, mediaDir, removeLegacyCaches, readSettings, writeSetting } from './paths.js';
import * as projects from './projects.js';
import * as wikipedia from './wikipedia.js';
import * as offline from './offline.js';
import * as files from './files.js';
import * as history from './history.js';
import { seedExample } from './example.js';
import * as web from './web.js';
import { PARTITION, memorySession } from './http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', 'renderer');
const ICON = path.join(HERE, '..', '..', 'build', 'icon.png');
const isMac = process.platform === 'darwin';

app.setName('WikiTree');
// Separate data folder (portable use, tests).
if (process.env.WIKITREE_HOME) app.setPath('userData', process.env.WIKITREE_HOME);

// Chromium's own session files (HTTP cache, code cache, local storage…) go to a temporary folder
// that is deleted when the app quits, so the data folder only holds projects and settings.
const SESSION_ROOT = path.join(os.tmpdir(), 'wikitree-session');
const SESSION_DIR = path.join(SESSION_ROOT, String(process.pid));
fs.mkdirSync(SESSION_DIR, { recursive: true });
app.setPath('sessionData', SESSION_DIR);
const removeSessionDir = () => { try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch { /* best effort */ } };
app.on('quit', removeSessionDir);
process.on('exit', removeSessionDir);
// Leftovers from runs that crashed (their process is gone).
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const d of fs.readdirSync(SESSION_ROOT)) {
  if (/^\d+$/.test(d) && Number(d) !== process.pid && !alive(Number(d))) fs.rmSync(path.join(SESSION_ROOT, d), { recursive: true, force: true });
}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

protocol.registerSchemesAsPrivileged([
  { scheme: 'wikitree', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ---------- IPC ----------
const decoderFor = (sender) => (request) => sender.executeJavaScript(
  `import('wikitree://app/lib/file-validation.js').then(m => m.validateAttachmentUrl(${JSON.stringify(request)}))`);
const handlers = {
  'projects:list': () => projects.listProjects(),
  'projects:create': (root, sender) => projects.createProject(root, decoderFor(sender)),
  'projects:get': (id) => projects.getProject(id),
  'projects:save': (p) => projects.saveProject(p),
  'projects:delete': (id) => projects.deleteProject(id),
  'history:list': ({ projectId, beforeSeq, limit }) => history.listHistory(checkId(projectId), beforeSeq, Math.min(Number(limit) || 100, 500)),
  'history:snapshot': ({ projectId, seq }) => history.snapshotAt(checkId(projectId), Number(seq)),
  'history:restore': ({ projectId, seq }) => projects.restoreSnapshot({ projectId: checkId(projectId), seq: Number(seq) }),
  'wiki:search': (a) => wikipedia.search(a),
  'wiki:summary': (a) => wikipedia.summary(a),
  'wiki:page': (a) => wikipedia.page(a),
  'wiki:namespaces': (lang) => wikipedia.namespaces(lang),
  'web:search': (a) => web.search(a),
  'web:info': (url) => web.pageInfo(url),
  'offline:save': (a) => offline.savePage(a),
  'offline:remove': (a) => offline.removePage(a),
  'offline:state': (a) => offline.savedState(a),
  'files:import': (a, sender) => files.importFile(a, decoderFor(sender)),
  'files:collect': (projectId) => files.collectFiles(projectId),
  'settings:set': ({ key, value }) => {
    if (key === 'lang') return writeSetting('lang', String(value));
    if (key === 'theme' && (value === 'light' || value === 'dark')) return writeSetting('theme', value);
    return null;
  },
  'open-external': (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); },
};

function registerIpc() {
  // Errors cross IPC as values so the renderer gets clean messages.
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, async (_e, arg) => {
      try { return { ok: true, value: await fn(arg, _e.sender) }; } catch (e) { return { ok: false, error: e.message }; }
    });
  }
  // Synchronous save while a window closes, so the last change is never lost.
  ipcMain.on('projects:save-sync', (e, p) => {
    try { projects.saveProjectSync(p); e.returnValue = { ok: true }; } catch (err) { e.returnValue = { ok: false, error: err.message }; }
  });
  ipcMain.on('settings:get', (e) => { e.returnValue = readSettings(); });
}

// ---------- app protocol ----------
//   wikitree://app/…                  the UI
//   wikitree://media/<project>/<file> images of downloaded articles
//   wikitree://file/<project>/<file>  attached files (range requests for video/audio)
function serveFile(base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

function registerProtocol() {
  // Registered on the in-memory session the window uses.
  memorySession().protocol.handle('wikitree', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname);
    if (u.host === 'import') return files.serveImportFile(rel.slice(1), req);
    if (u.host === 'media') {
      const [, pid, file] = rel.split('/');
      if (!validId(pid) || !/^[\w.]+$/.test(file || '')) return new Response('Not found', { status: 404 });
      return serveFile(mediaDir(pid), file);
    }
    if (u.host === 'file') {
      const [, pid, file] = rel.split('/');
      if (!validId(pid) || !/^[a-z0-9]+\.[a-z0-9]+$/.test(file || '')) return new Response('Not found', { status: 404 });
      return files.serveProjectFile(pid, file, req);
    }
    return serveFile(RENDERER, rel);
  });
}

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 500,
    title: 'WikiTree',
    backgroundColor: readSettings().theme === 'light' ? '#f6f6f7' : '#1c1c1e',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: PARTITION,
      spellcheck: false,
      plugins: true, // built-in PDF viewer for attached PDFs
    },
  });
  // Never leave the app: in-window navigation is blocked, external links open in the system browser.
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

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(async () => {
  session.defaultSession.setSpellCheckerEnabled(false); // no dictionary download
  await initDirs(app.getPath('userData'));
  await projects.migrateLegacy();
  await seedExample().catch((e) => console.error('example project', e.message));
  await removeLegacyCaches();
  registerIpc();
  registerProtocol();
  web.allowFraming(memorySession());
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
