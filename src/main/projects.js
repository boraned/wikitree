// Project files: list, create, read, save (async + sync for window close), delete, migrate.
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  dirs, validId, checkLang, newId, projectDir, projectFile, writeAtomic, writeAtomicSync,
} from './paths.js';

export async function listProjects() {
  const out = [];
  for (const d of await fs.readdir(dirs.data, { withFileTypes: true })) {
    if (!d.isDirectory() || !validId(d.name)) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(dirs.data, d.name, 'project.json'), 'utf8'));
      const pictured = Object.values(p.nodes).filter((n) => n.type === 'wiki' && (n.thumbLocal || n.thumb));
      out.push({
        id: p.id,
        title: p.title,
        updated: p.updated,
        count: Object.keys(p.nodes).length,
        thumbs: pictured.slice(0, 4).map((n) => n.thumbLocal || n.thumb),
      });
    } catch { /* unreadable project — skip */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

/** `root` is the first node: { type: 'wiki' | 'header', title, lang?, description?, thumb? }. */
export async function createProject(root) {
  const type = root?.type === 'wiki' ? 'wiki' : 'header';
  const title = String(root?.title || '').trim().slice(0, 300);
  if (!title) throw new Error('Title required');
  const id = newId();
  const rootId = newId();
  const now = Date.now();
  const node = { id: rootId, type, title, parent: null, children: [], x: 0, y: 0 };
  if (type === 'wiki') {
    Object.assign(node, { lang: checkLang(root.lang), description: root.description || '', thumb: root.thumb || null });
  }
  const p = { id, title, created: now, updated: now, rootId, nodes: { [rootId]: node } };
  await fs.mkdir(projectDir(id), { recursive: true });
  await writeAtomic(projectFile(id), JSON.stringify(p));
  return p;
}

export async function getProject(id) {
  try { return JSON.parse(await fs.readFile(projectFile(id), 'utf8')); } catch { throw new Error('Project not found'); }
}

function serialize(p) {
  const root = p?.nodes?.[p.rootId];
  if (!validId(p?.id) || !root || root.parent != null) throw new Error('Invalid project');
  p.updated = Date.now();
  p.title = root.title;
  return JSON.stringify(p);
}

export async function saveProject(p) {
  const text = serialize(p);
  await fs.mkdir(projectDir(p.id), { recursive: true });
  await writeAtomic(projectFile(p.id), text);
  return { updated: p.updated };
}

export function saveProjectSync(p) {
  const text = serialize(p);
  fss.mkdirSync(projectDir(p.id), { recursive: true });
  writeAtomicSync(projectFile(p.id), text);
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
