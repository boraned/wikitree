#!/usr/bin/env node
// Builds the bundled "Tree" example: the top levels of a complete binary reality project, replayed as one
// history revision per added article. The source project is only read.
//   node tools/reality/example-tree.mjs --project 58de1978420b [--home ~/.config/WikiTree] [--levels 10] [--fold-depth 4]
// A last revision folds branches below --fold-depth so the project opens as a readable overview.
// Output: src/main/example/tree/{project.json,history/} — copied into a new user's data folder on first launch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDirs, projectDir, projectFile, writeAtomicSync } from '../../src/main/paths.js';
import { seedHistory, recordChange, snapshotAt, listHistory } from '../../src/main/history.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const sourceId = arg('project', '');
const home = arg('home', path.join(os.homedir(), '.config', 'WikiTree'));
const levels = Number(arg('levels', 10));
const foldDepth = Number(arg('fold-depth', 4));
const EXAMPLE_ID = 'exampletree';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'src', 'main', 'example', 'tree');
if (!sourceId || !Number.isInteger(levels) || levels < 1 || levels > 16 || !Number.isInteger(foldDepth) || foldDepth < 0) {
  throw new Error('Usage: example-tree.mjs --project ID [--home PATH] [--levels 10] [--fold-depth 4]');
}

const source = JSON.parse(fs.readFileSync(path.join(home, 'projects', sourceId, 'project.json'), 'utf8'));
const want = 2 ** levels - 1;
const order = [];
for (let queue = [[source.rootId, 0]]; queue.length && order.length < want;) {
  const [id, depth] = queue.shift();
  const n = source.nodes[id];
  if (n.type !== 'wiki') throw new Error(`Non-Wikipedia node: ${n.title}`);
  if (depth < levels - 1 && n.children.length !== 2) throw new Error(`${n.title} has ${n.children.length} children; the top ${levels} levels are not a perfect binary tree`);
  order.push(id);
  if (depth < levels - 1) queue.push(...n.children.map((c) => [c, depth + 1]));
}
if (order.length !== want) throw new Error(`Only ${order.length}/${want} nodes available`);

const staging = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wikitree-example-'));
try {
  await initDirs(staging);
  const base = source.created;
  const keep = new Set(order);
  const node = (id) => {
    const { id: _id, type, title, lang, description, thumb, parent } = source.nodes[id];
    return { id, type, title, lang, description: description || '', thumb: thumb || null, parent: keep.has(parent) ? parent : null, children: [] };
  };
  const root = node(order[0]);
  const project = { id: EXAMPLE_ID, title: root.title, created: base, updated: base, rootId: root.id, roots: [root.id], nodes: { [root.id]: root } };
  if (Array.isArray(source.cover) && source.cover.length) project.cover = source.cover.slice(0, 6);
  fs.mkdirSync(projectDir(EXAMPLE_ID), { recursive: true });
  seedHistory(project, 'Project created', base);
  const { nodes: _omit, ...meta } = project;
  let bytes = JSON.stringify(project).length;
  order.slice(1).forEach((id, i) => {
    const n = node(id);
    const parent = project.nodes[n.parent];
    const previous = { ...meta, nodes: { [parent.id]: { ...parent, children: [...parent.children] } } };
    project.nodes[id] = n;
    parent.children.push(id);
    project.updated = base + i + 1;
    bytes += JSON.stringify(n).length + id.length + 6;
    recordChange(previous, project, { touched: [id, parent.id], at: project.updated, bytes });
  });
  const depthOf = (id) => { let d = 0; for (let n = project.nodes[id]; n.parent; n = project.nodes[n.parent]) d++; return d; };
  const fold = foldDepth ? order.filter((id) => project.nodes[id].children.length && depthOf(id) === foldDepth) : [];
  if (fold.length) {
    const previous = { ...meta, nodes: Object.fromEntries(fold.map((id) => [id, { ...project.nodes[id] }])) };
    for (const id of fold) project.nodes[id].collapsed = true;
    project.updated += 1;
    recordChange(previous, project, { touched: fold, at: project.updated, summary: `Folded ${fold.length} branches below level ${foldDepth} for an overview`, bytes });
  }
  writeAtomicSync(projectFile(EXAMPLE_ID), JSON.stringify(project));

  const log = listHistory(EXAMPLE_ID, Infinity, 1e6).entries;
  if (JSON.stringify(snapshotAt(EXAMPLE_ID, log[0].seq).nodes) !== JSON.stringify(project.nodes)) throw new Error('History does not rebuild the project');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(projectDir(EXAMPLE_ID), out, { recursive: true });
  const counts = Object.values(project.nodes).map((n) => n.children.length);
  console.log(JSON.stringify({
    id: EXAMPLE_ID, title: project.title, nodes: order.length, revisions: log.length,
    snapshots: log.filter((e) => e.snapshot).length, leaves: counts.filter((c) => c === 0).length, folded: fold.length,
    twoChildParents: counts.filter((c) => c === 2).length, maxDepth: Math.max(...order.map(depthOf)),
    rootChildren: project.nodes[root.id].children.map((c) => project.nodes[c].title), out: path.relative(repo, out),
  }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
