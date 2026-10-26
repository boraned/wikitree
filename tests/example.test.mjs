// First-launch example: new users get the bundled 1,023-article "Tree" project with its build history, once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, launch, finish, check } from './helpers.mjs';
import { initDirs } from '../src/main/paths.js';
import { snapshotAt, listHistory } from '../src/main/history.js';

const bundle = path.join(ROOT, 'src', 'main', 'example', 'tree');
const fresh = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wikitree-example-'));
const existing = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wikitree-existing-'));
const shots = process.env.WIKITREE_SCREENSHOT_DIR;
try {
  // ---------- the bundled project itself ----------
  const p = JSON.parse(fs.readFileSync(path.join(bundle, 'project.json'), 'utf8'));
  const nodes = Object.values(p.nodes);
  const depth = (n) => { let d = 0; for (let x = n; x.parent; x = p.nodes[x.parent]) d++; return d; };
  check('bundled example is called Tree with the Tree article at its root', p.title === 'Tree' && !p.label && p.nodes[p.rootId].title === 'Tree');
  check('it is a perfect binary tree: 1,023 articles, 10 levels, 512 leaves',
    nodes.length === 1023 && p.roots.length === 1
    && nodes.every((n) => n.children.length === (depth(n) < 9 ? 2 : 0))
    && nodes.filter((n) => !n.children.length).length === 512
    && nodes.every((n) => n.type === 'wiki' && n.children.every((c) => p.nodes[c].parent === n.id)));
  check('every article is unique', new Set(nodes.map((n) => n.title)).size === 1023);
  check('branches below level 4 start folded for a readable overview',
    nodes.filter((n) => n.collapsed).length === 16 && nodes.every((n) => !n.collapsed || depth(n) === 4));

  // ---------- a new user's first launch ----------
  let { app, win } = await launch({ home: fresh, example: true });
  await win.waitForSelector('.card:not(.new-card)');
  const card = await win.locator('.card:not(.new-card)').allTextContents();
  check('a new user starts with the Tree project on the main menu', card.length === 1 && card[0].includes('Tree') && card[0].includes('1023'), JSON.stringify(card));
  const seeded = path.join(fresh, 'projects', p.id);
  await initDirs(fresh);
  const log = listHistory(p.id, Infinity, 1e6).entries.reverse();
  check('it carries its full build history: created, one revision per added article, then the overview fold',
    log.length === 1024 && log[0].summary === 'Project created' && log[1].summary === 'Added: Plant under Tree'
    && log.slice(1, -1).every((e) => e.summary.startsWith('Added: ')) && log.at(-1).summary.startsWith('Folded 16 branches'),
    `${log.length} ${log[0]?.summary} ${log[1]?.summary} ${log.at(-1)?.summary}`);
  check('the history rebuilds the project exactly', JSON.stringify(snapshotAt(p.id, log.at(-1).seq).nodes) === JSON.stringify(p.nodes));
  await win.click('.card:not(.new-card)');
  await win.waitForSelector('.node.is-root');
  await win.waitForTimeout(600);
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(400);
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await win.screenshot({ path: path.join(shots, 'example-tree.png') }); }
  check('the example opens on its first five levels (31 articles)', await win.locator('.node').count() === 31, `${await win.locator('.node').count()}`);
  await win.click('.tree-controls-toggle');
  await win.click('.expand-all');
  await win.waitForFunction(() => document.querySelectorAll('.node').length === 1023, null, { timeout: 30000 });
  check('Expand all shows all 1,023 articles', true);
  await win.click('.tree-bottom-actions .history-btn');
  await win.waitForSelector('.history-row');
  const summaries = await win.locator('.history-summary').allTextContents();
  check('its history is listed in the History log', summaries.some((s) => s.startsWith('Added: ')), summaries.slice(0, 3).join(' | '));
  await app.close();
  check('opening it keeps a 1,023-article project', Object.keys(JSON.parse(fs.readFileSync(path.join(seeded, 'project.json'), 'utf8')).nodes).length === 1023);

  // ---------- offered once ----------
  fs.rmSync(seeded, { recursive: true, force: true });
  ({ app, win } = await launch({ home: fresh, example: true }));
  await win.waitForSelector('.new-card');
  await win.waitForTimeout(300);
  check('deleting the example does not bring it back on the next launch', await win.locator('.card:not(.new-card)').count() === 0 && !fs.existsSync(seeded));
  await app.close();

  // ---------- existing users are left alone ----------
  fs.mkdirSync(path.join(existing, 'projects', 'abcdef123456'), { recursive: true });
  fs.writeFileSync(path.join(existing, 'projects', 'abcdef123456', 'project.json'), JSON.stringify({
    id: 'abcdef123456', title: 'Mine', created: 1, updated: 1, rootId: 'r', roots: ['r'], nodes: { r: { id: 'r', type: 'header', title: 'Mine', parent: null, children: [] } } }));
  ({ app, win } = await launch({ home: existing, example: true }));
  await win.waitForSelector('.card:not(.new-card)');
  check('users who already have projects do not get the example', (await win.locator('.card:not(.new-card)').allTextContents()).join().includes('Mine')
    && await win.locator('.card:not(.new-card)').count() === 1 && !fs.existsSync(path.join(existing, 'projects', p.id)));
  await app.close();
} finally {
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(existing, { recursive: true, force: true });
}
assert.ok(true);
finish();
