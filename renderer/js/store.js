// Current project state, mutations and debounced persistence.
import { api, showError } from './api.js';

let project = null;
let saveTimer = null;
let saving = Promise.resolve();

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function loadProject(id) {
  if (project?.id === id) return project;
  await flush();
  project = await api.project(id);
  return project;
}

export const current = () => project;
export const node = (id) => project?.nodes[id];

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!project) return saving;
  const snapshot = JSON.parse(JSON.stringify(project));
  saving = saving.then(() => api.saveProject(snapshot)).catch((e) => showError(`Not saved: ${e.message}`));
  return saving;
}

window.addEventListener('beforeunload', () => {
  if (saveTimer && project) api.saveProject(project);
});

export function addNode(parentId, data) {
  const parent = project.nodes[parentId];
  const id = uid();
  project.nodes[id] = { id, parent: parentId, children: [], ...data };
  parent.children.push(id);
  parent.collapsed = false;
  scheduleSave();
  return project.nodes[id];
}

export function removeNode(id) {
  const n = project.nodes[id];
  if (!n || n.type === 'root') return;
  const drop = (nid) => {
    project.nodes[nid].children.forEach(drop);
    delete project.nodes[nid];
  };
  const parent = project.nodes[n.parent];
  parent.children = parent.children.filter((c) => c !== id);
  drop(id);
  scheduleSave();
}

export function renameNode(id, title) {
  const n = project.nodes[id];
  n.title = title;
  if (n.type === 'root') project.title = title;
  scheduleSave();
}

export function toggleCollapse(id) {
  const n = project.nodes[id];
  n.collapsed = !n.collapsed;
  scheduleSave();
}

export function moveNode(id, dir) {
  const n = project.nodes[id];
  const sib = project.nodes[n.parent].children;
  const i = sib.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= sib.length) return;
  [sib[i], sib[j]] = [sib[j], sib[i]];
  scheduleSave();
}

export function descendantCount(id) {
  const n = project.nodes[id];
  return n.children.reduce((s, c) => s + 1 + descendantCount(c), 0);
}

export function pathTo(id) {
  const out = [];
  for (let n = project.nodes[id]; n; n = project.nodes[n.parent]) out.unshift(n);
  return out;
}

export function findChildByTitle(parentId, title) {
  const t = title.toLowerCase();
  return project.nodes[parentId].children
    .map((c) => project.nodes[c])
    .find((c) => c.type === 'wiki' && c.title.toLowerCase() === t);
}
