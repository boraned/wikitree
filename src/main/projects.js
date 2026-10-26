// Project files: list, create, read, save (async + sync for window close), delete, migrate.
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  dirs, validId, checkLang, newId, projectDir, projectFile, writeAtomic, writeAtomicSync,
} from './paths.js';
import { importFile } from './files.js';
import { seedHistory, recordChange, snapshotAt } from './history.js';
import { checkWebUrl } from './web-url.js';

export const fileUrl = (projectId, file) => `wikitree://file/${projectId}/${file}`;

export async function listProjects() {
  const out = [];
  for (const d of await fs.readdir(dirs.data, { withFileTypes: true })) {
    if (!d.isDirectory() || !validId(d.name)) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(dirs.data, d.name, 'project.json'), 'utf8'));
      const thumbs = Object.values(p.nodes).map((n) => {
        if (n.type === 'wiki') return n.thumbLocal || n.thumb;
        if (n.type === 'file' && n.kind === 'image') return fileUrl(p.id, n.file);
        return null;
      }).filter(Boolean);
      out.push({
        id: p.id,
        title: p.label || p.title,
        updated: p.updated,
        count: Object.keys(p.nodes).length,
        thumbs: Array.isArray(p.cover) && p.cover.length ? p.cover.slice(0, 6) : thumbs.slice(0, 4),
      });
    } catch { /* unreadable project — skip */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

/**
 * `root` is the first node: { type: 'wiki', title, lang, description?, thumb? } | { type: 'header', title }
 * | { type: 'file', paths: [...] } — the first file becomes the top node, any others its children.
 */
export async function createProject(root, validate) {
  if (root?.type === 'file') return createFromFiles(root.paths || [], validate);
  const type = ['wiki', 'web'].includes(root?.type) ? root.type : 'header';
  const title = String(root?.title || '').trim().slice(0, 300);
  if (!title) throw new Error('Title required');
  const id = newId();
  const rootId = newId();
  const now = Date.now();
  const node = { id: rootId, type, title, parent: null, children: [], x: 0, y: 0 };
  if (type === 'wiki') {
    Object.assign(node, { lang: checkLang(root.lang), description: root.description || '', thumb: root.thumb || null });
  }
  if (type === 'web') node.url = checkWebUrl(root.url);
  const p = { id, title, created: now, updated: now, rootId, roots: [rootId], nodes: { [rootId]: node } };
  await fs.mkdir(projectDir(id), { recursive: true });
  await writeAtomic(projectFile(id), JSON.stringify(p));
  seedHistory(p);
  return p;
}

async function createFromFiles(paths, validate) {
  if (!paths.length) throw new Error('No file');
  const id = newId();
  await fs.mkdir(projectDir(id), { recursive: true });
  try {
    const now = Date.now();
    const rootId = newId();
    const first = await importFile({ projectId: id, path: paths[0] }, validate);
    const nodes = { [rootId]: { id: rootId, ...first, parent: null, children: [], x: 0, y: 0 } };
    for (const extra of paths.slice(1)) {
      try {
        const nid = newId();
        nodes[nid] = { id: nid, ...(await importFile({ projectId: id, path: extra }, validate)), parent: rootId, children: [] };
        nodes[rootId].children.push(nid);
      } catch { /* skip files that can't be added */ }
    }
    const p = { id, title: first.title, created: now, updated: now, rootId, roots: [rootId], nodes };
    await writeAtomic(projectFile(id), JSON.stringify(p));
    seedHistory(p);
    return p;
  } catch (e) {
    await fs.rm(projectDir(id), { recursive: true, force: true });
    throw e;
  }
}

export async function getProject(id) {
  try { return JSON.parse(await fs.readFile(projectFile(id), 'utf8')); } catch { throw new Error('Project not found'); }
}

function serialize(p) {
  const root = p?.nodes?.[p.rootId];
  if (!validId(p?.id) || !root || root.parent != null) throw new Error('Invalid project');
  p.roots = Array.isArray(p.roots) ? [...new Set(p.roots.filter((id) => p.nodes[id]?.parent == null))] : [p.rootId];
  if (!p.roots.includes(p.rootId)) p.roots.unshift(p.rootId);
  p.updated = Date.now();
  p.title = root.title;
  return JSON.stringify(p);
}

function previousVersion(id) {
  try { return JSON.parse(fss.readFileSync(projectFile(id), 'utf8')); } catch { return null; }
}

export async function saveProject(p) {
  const text = serialize(p);
  const previous = previousVersion(p.id);
  await fs.mkdir(projectDir(p.id), { recursive: true });
  await writeAtomic(projectFile(p.id), text);
  recordChange(previous, JSON.parse(text), { bytes: text.length });
  return { updated: p.updated };
}

export function saveProjectSync(p) {
  const text = serialize(p);
  const previous = previousVersion(p.id);
  fss.mkdirSync(projectDir(p.id), { recursive: true });
  writeAtomicSync(projectFile(p.id), text);
  recordChange(previous, JSON.parse(text), { bytes: text.length });
}

/** Makes an earlier revision the current project; the restore itself becomes a new revision. */
export async function restoreSnapshot({ projectId, seq }) {
  const snapshot = snapshotAt(projectId, seq);
  const previous = previousVersion(projectId);
  const text = serialize(snapshot);
  await writeAtomic(projectFile(projectId), text);
  recordChange(previous, JSON.parse(text), { summary: `Restored snapshot ${seq}`, bytes: text.length });
  return JSON.parse(text);
}

export async function deleteProject(id) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
  return { ok: true };
}

/** v1.0 stored projects as projects/<id>.json; move each into its own folder. */
export async function migrateLegacy() {
  for (const f of await fs.readdir(dirs.data)) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !validId(id)) continue;
    try {
      await fs.mkdir(projectDir(id), { recursive: true });
      await fs.access(projectFile(id)).then(
        () => fs.rm(path.join(dirs.data, f)), // already migrated by another window
        () => fs.rename(path.join(dirs.data, f), projectFile(id)),
      );
    } catch (e) { console.error('migrate', f, e.message); }
  }
}
