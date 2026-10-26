#!/usr/bin/env node
// Reality tree, variation #1: start at one article and hop through its blue links, always expanding the most
// "bigger picture" page next. A page's blue links are ranked by how central they are on Wikipedia (its vital-
// article level), whether they appear in the article's lead, and how often the article uses them. Each new article
// remains under the page whose blue link surfaced it. No article ever holds more than --max-children children:
// each article takes its best available links until its two direct slots are full, then the crawl continues below.
//
//   node tools/reality/crawl.mjs [--root Tree] [--nodes 5000] [--max-children 2] [--out ops.jsonl]
// Output: one JSON add per article, replayed into a project by build.mjs.
import path from 'node:path';
import { WORK, resolve, skippable, vitalLevels, articleLinks, closeReader, writer } from './lib.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const ROOT = arg('root', 'Tree');
const TARGET = Number(arg('nodes', 5000));
const MAX = Number(arg('max-children', 2));
if (!Number.isInteger(TARGET) || TARGET < 1 || !Number.isInteger(MAX) || MAX < 1) throw new Error('--nodes and --max-children must be positive integers');
const PER_PAGE = MAX * 8; // ranked blue-link candidates searched to fill each page's open child slots
const out = writer(arg('out', path.join(WORK, 'tree1.ops.jsonl')), true);

const vital = await vitalLevels();
const vitalScore = (title) => ({ 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 })[vital.get(title)] || 0;

const nodes = new Map(); // title → { id, title, parent, children:Set, depth, expanded, seq }
let seq = 0;
const ids = new Set();
const newId = () => { let id; do id = Math.random().toString(16).slice(2, 14).padEnd(12, '0'); while (ids.has(id)); ids.add(id); return id; };
function add(data, parent) {
  const n = { id: newId(), title: data.title, parent, children: new Set(), expanded: false, seq: seq++ };
  nodes.set(data.title, n);
  if (parent) nodes.get(parent).children.add(data.title);
  out({ op: 'add', id: n.id, parent: parent ? nodes.get(parent).id : null, title: data.title, description: data.description, thumb: data.thumb });
  return n;
}
const [rootData] = await resolve([ROOT]);
if (!rootData) throw new Error(`No article "${ROOT}"`);
add(rootData, null);

/** Get and rank the best Wikipedia blue links for one page. */
async function gather(page) {
  // Pre-rank on the link text's own title, then confirm only the strongest few dozen with Wikipedia.
  const prescore = (l) => vitalScore(l.title) * 2 + (l.lead ? 2 : 0) + Math.min(l.count, 6) * 0.3 - l.order * 0.001;
  const links = (await articleLinks(page.title)).sort((a, b) => prescore(b) - prescore(a)).slice(0, PER_PAGE * 6);
  const resolved = await resolve(links.map((l) => l.title));
  const candidates = new Map();
  links.forEach((l, i) => {
    const r = resolved[i];
    if (!r || skippable(r.title) || nodes.has(r.title) || r.title === page.title) return;
    const c = candidates.get(r.title) || { data: r, lead: false, count: 0, order: l.order };
    c.lead ||= l.lead;
    c.count += l.count;
    candidates.set(r.title, c);
  });
  const ranked = [...candidates.values()]
    .map((c) => ({ ...c, score: vitalScore(c.data.title) * 2 + (c.lead ? 2 : 0) + Math.min(c.count, 6) * 0.3 - c.order * 0.001 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, PER_PAGE);
  return ranked;
}

let logged = 0;
const BATCH = 1; // keep the shared article-cleaner page serial; it is reused but restarted every 500 pages
const better = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
while (nodes.size < TARGET) {
  // The unexpanded pages that best explain the bigger picture: highest vital level, then shallowest, then oldest.
  const open = [];
  for (const n of nodes.values()) {
    if (n.expanded) continue;
    if (n.children.size >= MAX) { n.expanded = true; continue; } // already holds related articles that moved under it
    open.push({ n, key: [vitalScore(n.title), -depthOf(n), -n.seq] });
  }
  if (!open.length) break;
  open.sort((a, b) => (better(a.key, b.key) ? -1 : better(b.key, a.key) ? 1 : 0));
  const pages = open.slice(0, BATCH).map((o) => o.n);
  const gathered = await Promise.all(pages.map(gather));

  for (const [p, page] of pages.entries()) {
    page.expanded = true;
    const ranked = gathered[p];
    // Each discovered article stays directly beneath the page whose blue links surfaced it. Other unique links
    // are skipped until this page's two child slots are full; no reparent can exceed the degree limit.
    for (const c of ranked) {
      if (page.children.size >= MAX || nodes.size >= TARGET) break;
      const title = c.data.title;
      if (nodes.has(title)) continue;
      add(c.data, page.title);
    }
  }
  if (Math.floor(nodes.size / 250) > logged) { logged = Math.floor(nodes.size / 250); console.error(`${nodes.size} nodes · expanded through "${pages.at(-1).title}"`); }
}

const maxChildren = Math.max(...[...nodes.values()].map((n) => n.children.size));
if (nodes.size !== TARGET || maxChildren > MAX) throw new Error(`Invalid crawl: ${nodes.size}/${TARGET} nodes, max children ${maxChildren}/${MAX}`);
console.error(`done: ${nodes.size} nodes, max ${maxChildren} children`);
await closeReader();
