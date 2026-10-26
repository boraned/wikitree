#!/usr/bin/env node
// Replays a reality-tree operations file into a WikiTree project, one history revision per operation.
//   node tools/reality/build.mjs --ops tree1.ops.jsonl [--home ~/.config/WikiTree] [--cover "Atom,Human,…"] [--fold-depth 2] [--label 'Tree — variation #1'] [--max-children 2]
// The project gets no node positions, so WikiTree lays the tree out the first time it is opened. With --fold-depth,
// a last revision folds every branch below that depth so the whole project opens as a readable overview.
// With --max-children, every revision is checked: no article may ever hold more children than that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDirs, newId, projectDir, projectFile, writeAtomicSync } from '../../src/main/paths.js';
import { seedHistory, recordChange, snapshotAt, listHistory } from '../../src/main/history.js';
import { resolve, firstPicture } from './lib.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const opsFile = arg('ops');
const home = arg('home', process.env.WIKITREE_HOME || path.join(os.homedir(), '.config', 'WikiTree'));
const foldDepth = Number(arg('fold-depth', 0));
const label = arg('label', '');
const maxChildren = Number(arg('max-children', 0));
const replaceId = arg('replace-project', '');
if (maxChildren && (!Number.isInteger(maxChildren) || maxChildren < 1)) throw new Error('--max-children must be a positive integer');
if (replaceId && !maxChildren) throw new Error('--replace-project requires --max-children for a guarded rebuild');
const coverTitles = (arg('cover', '') || '').split(',').map((t) => t.trim()).filter(Boolean);
if (!opsFile) throw new Error('--ops is required');

await initDirs(home);
const ops = fs.readFileSync(opsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (maxChildren) {
  const parents = new Map();
  const added = new Set();
  for (const op of ops) {
    if (op.op !== 'add') throw new Error('--max-children preflight expects add-only operations');
    if (added.has(op.id) || (op.parent && !added.has(op.parent))) throw new Error(`Invalid add order at ${op.title}`);
    added.add(op.id);
    if (op.parent) {
      const count = (parents.get(op.parent) || 0) + 1;
      if (count > maxChildren) throw new Error(`${op.title} would exceed --max-children ${maxChildren}`);
      parents.set(op.parent, count);
    }
  }
}
const coverData = await resolve(coverTitles);
const cover = await Promise.all(coverData.map(async (r, i) => {
  const picture = r?.thumb || await firstPicture(coverTitles[i]);
  if (!picture) throw new Error(`No picture for cover article "${coverTitles[i]}"`);
  return picture;
}));

const wikiNode = (op) => ({ id: op.id, type: 'wiki', title: op.title, lang: 'en', description: op.description || '', thumb: op.thumb || null, parent: op.parent, children: [] });
const [first, ...rest] = ops;
if (first?.op !== 'add' || first.parent !== null) throw new Error('The first operation must add the root');
let projectId = replaceId;
if (replaceId && !fs.existsSync(projectDir(replaceId))) throw new Error(`Project to replace not found: ${replaceId}`);
if (!replaceId) do { projectId = newId(); } while (fs.existsSync(projectDir(projectId)));
const project = { id: projectId, title: first.title, ...(label ? { label } : {}), created: first.at, updated: first.at, rootId: first.id, roots: [first.id], nodes: { [first.id]: wikiNode(first) } };
if (cover.length) project.cover = cover;
if (replaceId) fs.rmSync(projectDir(project.id), { recursive: true, force: true });
fs.mkdirSync(projectDir(project.id), { recursive: true });
seedHistory(project, 'Project created', first.at);

let bytes = JSON.stringify(project).length;
const { nodes: _omit, ...meta } = project;
for (const op of rest) {
  const n = project.nodes[op.id];
  const touched = op.op === 'add' ? [op.id, op.parent] : [op.id, n.parent, op.parent];
  const previous = { ...meta, nodes: Object.fromEntries(touched.filter((id) => project.nodes[id]).map((id) => [id, { ...project.nodes[id], children: [...project.nodes[id].children] }])) };
  if (op.op === 'add') {
    project.nodes[op.id] = wikiNode(op);
    project.nodes[op.parent].children.push(op.id);
    bytes += JSON.stringify(project.nodes[op.id]).length + op.id.length + 6;
  } else if (op.op === 'move') {
    const old = project.nodes[n.parent];
    old.children = old.children.filter((c) => c !== op.id);
    n.parent = op.parent;
    project.nodes[op.parent].children.push(op.id);
  } else throw new Error(`Unknown operation ${op.op}`);
  if (maxChildren && project.nodes[op.parent].children.length > maxChildren) {
    throw new Error(`${project.nodes[op.parent].title} would hold ${project.nodes[op.parent].children.length} children`);
  }
  project.updated = op.at;
  recordChange(previous, project, { touched, at: op.at, bytes });
}
if (foldDepth > 0) {
  const depth = (id) => { let d = 0; for (let n = project.nodes[id]; n.parent; n = project.nodes[n.parent]) d++; return d; };
  const fold = Object.keys(project.nodes).filter((id) => project.nodes[id].children.length && depth(id) >= foldDepth);
  const previous = { ...meta, nodes: Object.fromEntries(fold.map((id) => [id, { ...project.nodes[id] }])) };
  for (const id of fold) project.nodes[id].collapsed = true;
  project.updated = Date.now();
  recordChange(previous, project, { touched: fold, summary: `Folded ${fold.length} branches below ring ${foldDepth} for an overview`, bytes });
}
writeAtomicSync(projectFile(project.id), JSON.stringify(project));

const log = listHistory(project.id, Infinity, 1e6).entries;
const rebuilt = snapshotAt(project.id, log[0].seq);
const historyBytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? historyBytes(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(JSON.stringify({
  id: project.id,
  title: project.title,
  nodes: Object.keys(project.nodes).length,
  revisions: log.length,
  moves: log.filter((e) => e.summary.startsWith('Moved')).length,
  snapshots: log.filter((e) => e.snapshot).length,
  projectBytes: fs.statSync(projectFile(project.id)).size,
  historyBytes: historyBytes(path.join(projectDir(project.id), 'history')),
  rebuildMatches: JSON.stringify(rebuilt.nodes) === JSON.stringify(project.nodes),
}, null, 1));
