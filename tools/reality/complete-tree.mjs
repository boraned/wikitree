#!/usr/bin/env node
// Convert an existing single-root, Wikipedia-only project to a complete binary tree.
// Nodes keep their IDs and BFS reading order; only parent links are rebuilt in the emitted add operations.
// For exactly 5,000 nodes, every internal node has two children except the final internal node, which has one.
//   node tools/reality/complete-tree.mjs --project ID [--home ~/.config/WikiTree] [--max-children 2] [--out ops.jsonl]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDirs } from '../../src/main/paths.js';
import { getProject } from '../../src/main/projects.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const projectId = arg('project', '');
const home = arg('home', process.env.WIKITREE_HOME || path.join(os.homedir(), '.config', 'WikiTree'));
const maxChildren = Number(arg('max-children', 2));
const outFile = arg('out', path.join(process.env.TMPDIR || os.tmpdir(), 'reality', `${projectId}-complete.ops.jsonl`));
if (!projectId || !Number.isInteger(maxChildren) || maxChildren !== 2) {
  throw new Error('Usage: complete-tree.mjs --project ID [--home PATH] [--max-children 2] [--out FILE]');
}

await initDirs(home);
const project = await getProject(projectId);
const nodes = project.nodes;
const order = [];
const seen = new Set();
const queue = [project.rootId];
while (queue.length) {
  const id = queue.shift();
  if (seen.has(id)) throw new Error(`Cycle or repeated child at ${nodes[id]?.title || id}`);
  const node = nodes[id];
  if (!node) throw new Error(`Missing node ${id}`);
  if (node.type !== 'wiki') throw new Error(`Non-Wikipedia node: ${node.title}`);
  seen.add(id);
  order.push(id);
  queue.push(...node.children);
}
if (order.length !== Object.keys(nodes).length) throw new Error(`Only ${order.length}/${Object.keys(nodes).length} nodes are reachable from the root`);
if (project.roots?.length !== 1 || project.roots[0] !== project.rootId) throw new Error('Expected exactly one root');

const children = new Array(order.length).fill(0);
const operations = order.map((id, index) => {
  const node = nodes[id];
  const parent = index === 0 ? null : order[Math.floor((index - 1) / maxChildren)];
  if (parent) children[Math.floor((index - 1) / maxChildren)]++;
  return { at: Date.now() + index, op: 'add', id, parent, title: node.title,
    description: node.description || '', thumb: node.thumb || null };
});
const max = Math.max(...children);
if (max > maxChildren) throw new Error(`Complete-tree construction exceeded ${maxChildren} children`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${operations.map((op) => JSON.stringify(op)).join('\n')}\n`);
const depth = Math.floor(Math.log2(order.length));
console.log(JSON.stringify({ project: project.label || project.title, nodes: order.length, maxChildren: max,
  twoChildParents: children.filter((count) => count === 2).length,
  oneChildParents: children.filter((count) => count === 1).length,
  leaves: children.filter((count) => count === 0).length, maxDepth: depth,
  rootChildren: order.slice(1, 3).map((id) => nodes[id].title), outFile }));
