// Exposes a minimal, typed bridge to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (name, arg) => {
  const r = await ipcRenderer.invoke(name, arg);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

contextBridge.exposeInMainWorld('wikitree', {
  projects: () => call('projects:list'),
  createProject: (title) => call('projects:create', title),
  project: (id) => call('projects:get', id),
  saveProject: (p) => call('projects:save', p),
  deleteProject: (id) => call('projects:delete', id),
  search: (q) => call('wiki:search', q),
  summary: (t) => call('wiki:summary', t),
  page: (t) => call('wiki:page', t),
  openExternal: (url) => call('open-external', url),
});
