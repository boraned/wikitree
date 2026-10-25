// Current project state, mutations and persistence.
// Each window holds its own copy; every change writes the whole copy back (last writer wins).
import { api, showError } from './api.js';

let project = null;
let saveTimer = null;
let dirty = false;
let saving = Promise.resolve();

export const GAP_Y = 70;   // vertical distance parent → child
export const GAP_X = 24;   // horizontal distance between siblings
export const EST = { w: 240, h: 66 };

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function loadProject(id) {
  if (project?.id === id) return project;
  await flush();
  project = normalize(await api.project(id));
  return project;
}

// Older files: root had type "root", nodes had no language.
function normalize(p) {
  const root = p.nodes[p.rootId];
  if (root.type === 'root') root.type = 'header';
  for (const n of Object.values(p.nodes)) if (n.type === 'wiki' && !n.lang) n.lang = 'en';
  return p;
}

export const current = () => project;
export const node = (id) => project?.nodes[id];

/** Marks the project changed; written to disk almost immediately. */
export function changed() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 120);
}

export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!project || !dirty) return saving;
  dirty = false;
  const snapshot = JSON.parse(JSON.stringify(project));
  saving = saving.then(() => api.saveProject(snapshot)).catch((e) => showError(`Not saved: ${e.message}`));
  return saving;
}

window.addEventListener('beforeunload', () => {
  if (dirty && project) {
    clearTimeout(saveTimer);
    dirty = false;
    api.saveProjectSync(project);
  }
});

/** Where a new child of `parent` goes: right of its last child, or straight below. */
export function childSlot(parent) {
  const last = project.nodes[parent.children.at(-1)];
  if (last && last.x != null) return { x: last.x + (last.w || EST.w) / 2 + GAP_X + EST.w / 2, y: last.y };
  return { x: parent.x ?? 0, y: (parent.y ?? 0) + (parent.h || EST.h) + GAP_Y };
}

export function addNode(parentId, data) {
  const parent = project.nodes[parentId];
  const id = uid();
  project.nodes[id] = { id, parent: parentId, children: [], ...data, ...childSlot(parent) };
  parent.children.push(id);
  parent.collapsed = false;
  changed();
  return project.nodes[id];
}

/** Removes a node and everything below it; returns the removed nodes. */
export function removeNode(id) {
  const n = project.nodes[id];
  if (!n || n.parent == null) return [];
  const removed = subtree(id).map((x) => project.nodes[x]);
  const parent = project.nodes[n.parent];
  parent.children = parent.children.filter((c) => c !== id);
  for (const r of removed) delete project.nodes[r.id];
  changed();
  return removed;
}

export function renameNode(id, title) {
  const n = project.nodes[id];
  n.title = title;
  if (n.parent == null) project.title = title;
  changed();
}

export function toggleCollapse(id) {
  const n = project.nodes[id];
  n.collapsed = !n.collapsed;
  changed();
}

export function subtree(id) {
  const out = [];
  const walk = (x) => { out.push(x); project.nodes[x].children.forEach(walk); };
  walk(id);
  return out;
}

export function isDescendant(id, ofId) {
  for (let n = project.nodes[id]; n; n = project.nodes[n.parent]) if (n.id === ofId) return true;
  return false;
}

export function shiftNodes(ids, dx, dy) {
  for (const i of ids) {
    const n = project.nodes[i];
    n.x += dx;
    n.y += dy;
  }
}

/** Attaches `id` (with its children) to a new parent and moves the branch below it. */
export function reparent(id, newParentId) {
  const n = project.nodes[id];
  if (n.parent == null || n.parent === newParentId || isDescendant(newParentId, id)) return false;
  const old = project.nodes[n.parent];
  old.children = old.children.filter((c) => c !== id);
  const target = project.nodes[newParentId];
  const slot = childSlot(target);
  shiftNodes(subtree(id), slot.x - n.x, slot.y - n.y);
  target.children.push(id);
  target.collapsed = false;
  n.parent = newParentId;
  changed();
  return true;
}

export function descendantCount(id) {
  return subtree(id).length - 1;
}

export function pathTo(id) {
  const out = [];
  for (let n = project.nodes[id]; n; n = project.nodes[n.parent]) out.unshift(n);
  return out;
}

const same = (n, title, lang) => n.type === 'wiki' && n.lang === lang && n.title.toLowerCase() === title.toLowerCase();

export function findChildByTitle(parentId, title, lang) {
  return project.nodes[parentId].children.map((c) => project.nodes[c]).find((c) => same(c, title, lang));
}

export function hasWiki(title, lang) {
  return Object.values(project.nodes).some((n) => same(n, title, lang));
}

export function wikiNodes() {
  return Object.values(project.nodes).filter((n) => n.type === 'wiki');
}
