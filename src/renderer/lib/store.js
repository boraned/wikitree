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

/** Drops the in-memory copy after an external restore, so the router reloads IndexedDB. */
export async function evict(id) {
  if (project?.id !== id) return;
  await flush();
  project = null;
}

// Older files: root had type "root", nodes had no language.
function normalize(p) {
  const root = p.nodes[p.rootId];
  if (root.type === 'root') root.type = 'header';
  p.roots = Array.isArray(p.roots) ? p.roots.filter((id) => p.nodes[id]?.parent == null) : [p.rootId];
  if (!p.roots.includes(p.rootId)) p.roots.unshift(p.rootId);
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

/** Adds a disconnected top-level node at the point selected on the empty canvas. */
export function addIndependentNode(data, position) {
  const id = uid();
  project.nodes[id] = { id, parent: null, children: [], ...data, x: position.x, y: position.y };
  project.roots ||= [project.rootId];
  project.roots.push(id);
  changed();
  return project.nodes[id];
}

/** Removes a node and everything below it; returns the removed nodes. */
export function removeNode(id) {
  const n = project.nodes[id];
  if (!n || (n.parent == null && id === project.rootId)) return [];
  const removed = subtree(id).map((x) => project.nodes[x]);
  if (n.parent == null) project.roots = project.roots.filter((rootId) => rootId !== id);
  else {
    const parent = project.nodes[n.parent];
    parent.children = parent.children.filter((c) => c !== id);
  }
  for (const r of removed) delete project.nodes[r.id];
  changed();
  return removed;
}

/** Detaches a node (with its branch) from its parent; it stays where it is as a separate top-level tree. */
export function detachNode(id) {
  const n = project.nodes[id];
  if (!n || n.parent == null) return false;
  const parent = project.nodes[n.parent];
  parent.children = parent.children.filter((c) => c !== id);
  n.parent = null;
  project.roots ||= [project.rootId];
  project.roots.push(id);
  changed();
  return true;
}

export function renameNode(id, title) {
  const n = project.nodes[id];
  n.title = title;
  if (id === project.rootId) project.title = title;
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
  const target = project.nodes[newParentId];
  const mainRoot = id === project.rootId;
  if (!n || !target || id === newParentId || n.parent === newParentId) return false;
  if (isDescendant(newParentId, id)) {
    if (!mainRoot) return false;
    // Lift the target out first, so attaching the old root below it cannot make a cycle.
    const old = project.nodes[target.parent];
    old.children = old.children.filter((c) => c !== newParentId);
    target.parent = null;
    project.roots.push(newParentId);
  }
  if (n.parent == null) project.roots = project.roots.filter((rootId) => rootId !== id);
  else {
    const old = project.nodes[n.parent];
    old.children = old.children.filter((c) => c !== id);
  }
  const slot = childSlot(target);
  shiftNodes(subtree(id).filter((x) => project.nodes[x].x != null), slot.x - (n.x ?? 0), slot.y - (n.y ?? 0));
  target.children.push(id);
  target.collapsed = false;
  n.parent = newParentId;
  if (mainRoot) {
    let top = target;
    while (top.parent != null) top = project.nodes[top.parent];
    project.rootId = top.id;
    project.title = top.title;
    // The project now represents its new root, not the previous display name.
    project.label = '';
    project.roots = [top.id, ...project.roots.filter((rootId) => rootId !== top.id)];
  }
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
