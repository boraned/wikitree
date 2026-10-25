// WikiTree — Electron main process entry: window, app protocol, menu, IPC.
import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initDirs, validId, mediaDir } from './paths.js';
import * as projects from './projects.js';
import * as wikipedia from './wikipedia.js';
import * as offline from './offline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', 'renderer');
const ICON = path.join(HERE, '..', '..', 'build', 'icon.png');
const isMac = process.platform === 'darwin';

app.setName('WikiTree');
// Separate data folder (portable use, tests).
if (process.env.WIKITREE_HOME) app.setPath('userData', process.env.WIKITREE_HOME);

protocol.registerSchemesAsPrivileged([
  { scheme: 'wikitree', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------- IPC ----------
const handlers = {
  'projects:list': () => projects.listProjects(),
  'projects:create': (root) => projects.createProject(root),
  'projects:get': (id) => projects.getProject(id),
  'projects:save': (p) => projects.saveProject(p),
  'projects:delete': (id) => projects.deleteProject(id),
  'wiki:search': (a) => wikipedia.search(a),
  'wiki:summary': (a) => wikipedia.summary(a),
  'wiki:page': (a) => wikipedia.page(a),
  'wiki:namespaces': (lang) => wikipedia.namespaces(lang),
  'offline:save': (a) => offline.savePage(a),
  'offline:remove': (a) => offline.removePage(a),
  'offline:state': (a) => offline.savedState(a),
  'open-external': (url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); },
};

function registerIpc() {
  // Errors cross IPC as values so the renderer gets clean messages.
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, async (_e, arg) => {
      try { return { ok: true, value: await fn(arg) }; } catch (e) { return { ok: false, error: e.message }; }
    });
  }
  // Synchronous save while a window closes, so the last change is never lost.
  ipcMain.on('projects:save-sync', (e, p) => {
    try { projects.saveProjectSync(p); e.returnValue = { ok: true }; } catch (err) { e.returnValue = { ok: false, error: err.message }; }
  });
}

// ---------- app protocol: wikitree://app/… (UI) and wikitree://media/<project>/<file> (offline images) ----------
function serveFile(base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

function registerProtocol() {
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
}

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 500,
    title: 'WikiTree',
    backgroundColor: '#1c1c1e',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
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
  await initDirs(app.getPath('userData'));
  await projects.migrateLegacy();
  registerIpc();
  registerProtocol();
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
