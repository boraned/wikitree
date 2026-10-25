// Minimal bridge between the renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

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
  search: (q, lang) => call('wiki:search', { q, lang }),
  summary: (title, lang) => call('wiki:summary', { title, lang }),
  page: (title, lang, projectId) => call('wiki:page', { title, lang, projectId }),
  namespaces: (lang) => call('wiki:namespaces', lang),
  savePage: (a) => call('offline:save', a),
  unsavePage: (a) => call('offline:remove', a),
  savedState: (projectId, items) => call('offline:state', { projectId, items }),
  settings: () => ipcRenderer.sendSync('settings:get'),
  setSetting: (key, value) => call('settings:set', { key, value }),
  openExternal: (url) => call('open-external', url),
});
