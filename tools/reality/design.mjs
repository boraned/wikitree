#!/usr/bin/env node
// Reality tree, variation #2: my own outline of reality, explained outward from one tree (tools/reality/tree2/*.txt).
// Every title is checked against Wikipedia (redirects followed); missing articles are dropped and their
// children move up to the nearest kept ancestor, and an article already placed elsewhere keeps its first place.
// The tree is then built top-down, ring by ring, and cut to exactly --nodes in that order. No article gets more
// than --max-children children: the largest topics among an article's children stay on it, and every further one is
// handed down into the branch it is most closely related to (the broader concept its Wikipedia definition names,
// its short description, shared defining concepts and title words), recursively.
//   node tools/reality/design.mjs [--nodes 5000] [--max-children 2] [--out tree2.ops.jsonl] [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK, resolve, writer, definingLinks, closeReader } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const TARGET = Number(arg('nodes', 5000));
const MAX = Number(arg('max-children', 2));
if (!Number.isInteger(TARGET) || TARGET < 1 || !Number.isInteger(MAX) || MAX < 1) throw new Error('--nodes and --max-children must be positive integers');
const checkOnly = process.argv.includes('--check');

// ---------- read the outline ----------
const dir = path.join(here, 'tree2');
const lines = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()
  .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((text, i) => ({ text: text.trim(), where: `${f}:${i + 1}` })))
  .filter((l) => l.text && !l.text.startsWith('#'));
const outline = new Map(); // written title → [children]
const pinned = new Map(); // written title → children it keeps directly
const order = [];
let root = null;
const problems = [];
for (const { text, where } of lines) {
  const at = text.indexOf(' > ');
  if (at < 0) { problems.push(`${where}: no " > "`); continue; }
  const parent = text.slice(0, at).trim();
  const kids = text.slice(at + 3).split('|').map((t) => t.trim()).filter(Boolean);
  if (!root) root = parent;
  else if (!order.includes(parent)) problems.push(`${where}: parent "${parent}" is not placed yet`);
  if (!order.includes(parent)) order.push(parent);
  outline.set(parent, [...(outline.get(parent) || []), ...kids]);
  // A line naming at most --max-children children is an explicit choice: they stay directly on the parent.
  if (kids.length <= MAX && !pinned.has(parent)) pinned.set(parent, kids);
  for (const k of kids) order.push(k);
}

// ---------- check every title ----------
const resolved = new Map();
const all = [...new Set(order)];
(await resolve(all)).forEach((r, i) => resolved.set(all[i], r));
const missing = all.filter((t) => !resolved.get(t));

// ---------- build the tree: first placement wins; missing titles pass their children up ----------
const placed = new Map(); // canonical → { title, data, parent, children, depth }
const rootData = resolved.get(root);
placed.set(rootData.title, { data: rootData, parent: null, children: [], depth: 0 });
const duplicates = [];
// Breadth-first over the outline, so a title's shallowest written place wins (a chapter is never taken over
// by a redirect deep inside an earlier chapter). A duplicate's own children join its first place.
let ring = (outline.get(root) || []).map((written) => ({ written, parent: rootData.title }));
const expanded = new Set([root]);
while (ring.length) {
  const nextRing = [];
  for (const { written, parent } of ring) {
    const r = resolved.get(written);
    let here = parent;
    if (r && !placed.has(r.title)) {
      const p = placed.get(parent);
      placed.set(r.title, { data: r, parent, children: [], depth: p.depth + 1 });
      p.children.push(r.title);
      here = r.title;
    } else if (r) {
      duplicates.push(written);
      here = r.title;
    }
    if (expanded.has(written)) continue;
    expanded.add(written);
    for (const k of outline.get(written) || []) nextRing.push({ written: k, parent: here });
  }
  ring = nextRing;
}

console.error(JSON.stringify({ written: order.length, unique: all.length, placed: placed.size, missing: missing.length, duplicates: duplicates.length, problems: problems.length }));
if (missing.length) console.error(`missing: ${missing.join(' · ')}`);
if (duplicates.length) console.error(`duplicates: ${duplicates.join(' · ')}`);
if (problems.length) console.error(problems.join('\n'));
const byChapter = Object.fromEntries((placed.get(rootData.title).children).map((c) => {
  let n = 0;
  const count = (t) => { n++; placed.get(t).children.forEach(count); };
  count(c);
  return [c, n];
}));
console.error(JSON.stringify(byChapter));
if (checkOnly) process.exit(0);
if (placed.size < TARGET) throw new Error(`Only ${placed.size} articles; ${TARGET} needed`);

// ---------- the articles that make the cut: top-down, ring by ring ----------
const chosen = [];
for (let queue = [rootData.title]; queue.length && chosen.length < TARGET;) {
  const next = [];
  for (const t of queue) {
    if (chosen.length >= TARGET) break;
    chosen.push(t);
    next.push(...placed.get(t).children);
  }
  queue = next;
}
const inCut = new Set(chosen);
const ownKids = (t) => placed.get(t).children.filter((c) => inCut.has(c));
// Planned branch size: how much of the explanation hangs below each article in the outline.
const planned = new Map();
const plannedSize = (t) => {
  if (!planned.has(t)) planned.set(t, 1 + placed.get(t).children.filter((c) => inCut.has(c)).reduce((s, c) => s + plannedSize(c), 0));
  return planned.get(t);
};
plannedSize(rootData.title);

// ---------- what each article says it is (its opening sentence's links, canonical) ----------
const defining = new Map();
for (let i = 0; i < chosen.length; i += 50) {
  const batch = chosen.slice(i, i + 50);
  const links = await Promise.all(batch.map((t) => definingLinks(t)));
  const canonical = await resolve(links.flat());
  let k = 0;
  batch.forEach((t, j) => { defining.set(t, new Set(links[j].map(() => canonical[k++]?.title).filter(Boolean))); });
  if (i % 1000 === 0) console.error(`definitions ${Math.min(i + 50, chosen.length)}/${chosen.length}`);
}
await closeReader();

// ---------- build with at most MAX children per article ----------
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim()} `;
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const wordsOf = (t) => new Set(norm(t).trim().split(' ').filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'into'].includes(w)).map(stem));
const words = new Map(chosen.map((t) => [t, wordsOf(t.replace(/ \(.*\)$/, ''))]));
const descriptionOf = new Map(chosen.map((t) => [t, norm(placed.get(t).data.description)]));
const nameOf = new Map(chosen.map((t) => [t, norm(t.replace(/ \(.*\)$/, ''))]));
function related(child, target) {
  const childDefines = defining.get(child), targetDefines = defining.get(target);
  let s = 0;
  if (childDefines.has(target)) s += 45;                       // "X is a kind of <target>"
  // Short description names it (one-word names such as "Energy" are too generic to count).
  if (nameOf.get(target).trim().includes(' ') && descriptionOf.get(child).includes(nameOf.get(target))) s += 24;
  if (targetDefines.has(child)) s += 4;
  for (const d of childDefines) if (targetDefines.has(d)) s += 6; // defined by the same broader concept
  const A = words.get(child), B = words.get(target);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  s += (shared / Math.max(1, A.size + B.size - shared)) * 10;
  return s;
}
// The planned branch of an article: its outline subtopics, nearest first (up to 400).
const branchOf = new Map();
const branch = (t) => {
  if (!branchOf.has(t)) {
    const out = [];
    for (let ring = ownKids(t); ring.length && out.length < 400; ring = ring.flatMap(ownKids)) out.push(...ring);
    branchOf.set(t, out.slice(0, 400));
  }
  return branchOf.get(t);
};
// Each article hangs a list of articles: its own outline children first, then any siblings handed down to it.
// With more than MAX in the list, the MAX largest topics (authored order breaks ties) become its children and every
// other entry is handed to the one of them whose branch it relates to most (its title and its own subtopics);
// with no relation, beside an outline sibling, else to the lighter branch. Handed-down entries keep their own subtopics.
const pinnedOf = new Map([...pinned].map(([written, kids]) => [resolved.get(written)?.title, kids.map((k) => resolved.get(k)?.title).filter(Boolean)]));
const tree = new Map([[rootData.title, { parent: null, children: [], depth: 0 }]]);
let regrouped = 0;
const work = [[rootData.title, ownKids(rootData.title)]];
while (work.length) {
  const [parent, list] = work.pop();
  let heads = list;
  const handed = new Map();
  if (list.length > MAX) {
    const order = new Map(list.map((t, i) => [t, i]));
    const kept = (pinnedOf.get(parent) || []).filter((t) => order.has(t));
    heads = [...kept, ...[...list].filter((t) => !kept.includes(t))
      .sort((a, b) => plannedSize(b) - plannedSize(a) || order.get(a) - order.get(b))].slice(0, MAX)
      .sort((a, b) => order.get(a) - order.get(b));
    for (const h of heads) handed.set(h, []);
    const load = new Map(heads.map((h) => [h, plannedSize(h)]));
    for (const t of list) {
      if (heads.includes(t)) continue;
      let best = null;
      for (const h of heads) {
        let near = 0;
        // Deeper in the branch only a definite link counts (its definition or description names it).
        for (const k of branch(h)) if (k !== t) { const r = related(t, k); if (r >= 20) near = Math.max(near, r); }
        // With equal evidence, stay beside an outline sibling.
        const sibling = placed.get(h).parent === placed.get(t).parent ? 0.01 : 0;
        const score = related(t, h) + near * 0.6 + sibling;
        // No evidence at all: the lighter branch, so unrelated topics do not sink into one long chain.
        if (!best || score > best.score || (score === 0 && best.score === 0 && load.get(h) < load.get(best.h))) best = { h, score };
      }
      handed.get(best.h).push(t);
      load.set(best.h, load.get(best.h) + plannedSize(t));
      regrouped++;
    }
  }
  for (const h of heads) {
    tree.set(h, { parent, children: [], depth: tree.get(parent).depth + 1 });
    tree.get(parent).children.push(h);
  }
  for (const h of [...heads].reverse()) work.push([h, [...ownKids(h), ...(handed.get(h) || [])]]);
}
if (tree.size !== chosen.length) throw new Error(`Placed ${tree.size} of ${chosen.length}`);

// ---------- emit additions top-down, ring by ring ----------
const out = writer(arg('out', path.join(WORK, 'tree2.ops.jsonl')), true);
const ids = new Map();
const id = (t) => { if (!ids.has(t)) ids.set(t, Math.random().toString(16).slice(2, 14).padEnd(12, '0')); return ids.get(t); };
for (let ring = [rootData.title]; ring.length;) {
  const next = [];
  for (const t of ring) {
    const { parent, children } = tree.get(t);
    const { data } = placed.get(t);
    const outlineParent = placed.get(t).parent;
    out({ op: 'add', id: id(t), parent: parent ? id(parent) : null, title: t, description: data.description, thumb: data.thumb, ...(parent !== outlineParent ? { outlineParent } : {}) });
    next.push(...children);
  }
  ring = next;
}
const widest = Math.max(...[...tree.values()].map((n) => n.children.length));
const deepest = Math.max(...[...tree.values()].map((n) => n.depth));
if (widest > MAX) throw new Error(`An article has ${widest} children`);
// How many articles sit under their outline parent, an outline sibling, or an article their definition names.
const fits = chosen.filter((t) => {
  const p = tree.get(t).parent;
  if (!p) return true;
  return p === placed.get(t).parent || placed.get(p).parent === placed.get(t).parent || related(t, p) >= 20;
}).length;
console.error(JSON.stringify({ added: tree.size, handedDown: regrouped, fits, maxChildren: widest, depth: deepest,
  rootChildren: tree.get(rootData.title).children }));
