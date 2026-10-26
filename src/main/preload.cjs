// Minimal bridge between the renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (name, arg) => {
  const r = await ipcRenderer.invoke(name, arg);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

contextBridge.exposeInMainWorld('wikitree', {
  projects: () => call('projects:list'),
  createProject: (root) => call('projects:create', root),
  project: (id) => call('projects:get', id),
  saveProject: (p) => call('projects:save', p),
  saveProjectSync: (p) => ipcRenderer.sendSync('projects:save-sync', p),
  deleteProject: (id) => call('projects:delete', id),
  history: (projectId, beforeSeq, limit) => call('history:list', { projectId, beforeSeq, limit }),
  historySnapshot: (projectId, seq) => call('history:snapshot', { projectId, seq }),
  restoreSnapshot: (projectId, seq) => call('history:restore', { projectId, seq }),
  search: (q, lang) => call('wiki:search', { q, lang }),
  summary: (title, lang) => call('wiki:summary', { title, lang }),
  page: (title, lang, projectId) => call('wiki:page', { title, lang, projectId }),
  namespaces: (lang) => call('wiki:namespaces', lang),
  webSearch: (q) => call('web:search', { q }),
  webInfo: (url) => call('web:info', url),
  savePage: (a) => call('offline:save', a),
  unsavePage: (a) => call('offline:remove', a),
  savedState: (projectId, items) => call('offline:state', { projectId, items }),
  importFile: (projectId, path) => call('files:import', { projectId, path }),
  collectFiles: (projectId) => call('files:collect', projectId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  settings: () => ipcRenderer.sendSync('settings:get'),
  setSetting: (key, value) => call('settings:set', { key, value }),
  openExternal: (url) => call('open-external', url),
});
