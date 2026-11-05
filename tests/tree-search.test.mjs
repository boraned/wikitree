// Node search: Ctrl+F (Cmd+F on macOS) or the magnifier in the bottom controls finds a node, opens the
// folded branches above it and moves the view to it. Real keyboard and pointer events; no network needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { HOME, launch, overlaps, finish } from './helpers.mjs';

const fixtureDir = path.join(HOME, 'tree-search-fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });
const photo = path.join(fixtureDir, 'Harbour at dusk.png');
execFileSync(spawnSync('magick', ['-version']).error ? 'convert' : 'magick', ['-size', '1200x800', 'gradient:#23334a-#c87849', photo]);

const { app, win } = await launch();
let fixture;
const saved = () => JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8'));
const camera = () => win.$eval('.canvas', (el) => el.style.transform);
const zoom = () => win.$eval('.canvas', (el) => new DOMMatrix(getComputedStyle(el).transform).a);
/** A node's on-screen position relative to the tree viewport. */
const placement = (id) => win.evaluate((nodeId) => {
  const v = document.querySelector('.viewport').getBoundingClientRect();
  const r = document.querySelector(`.node[data-id="${nodeId}"]`)?.getBoundingClientRect();
  if (!r) return null;
  return {
    dx: Math.round(r.left + r.width / 2 - (v.left + v.width / 2)), dy: Math.round(r.top + r.height / 2 - (v.top + v.height / 2)),
    inside: r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom,
  };
}, id);
const centred = (at) => at && Math.abs(at.dx) <= 2 && Math.abs(at.dy) <= 2 && at.inside;
const results = () => win.locator('.node-search .result .title').allTextContents();
const closed = () => win.waitForSelector('.modal-back', { state: 'detached' });
const settle = () => win.waitForTimeout(700);

try {
  await win.waitForSelector('.wordmark');
  fixture = await win.evaluate(async (photoPath) => {
    const p = await window.wikitree.createProject({ type: 'header', title: 'Search fixture' });
    const add = (id, parent, data) => {
      p.nodes[id] = { ...data, id, parent, children: [] };
      if (parent) p.nodes[parent].children.push(id); else p.roots.push(id);
    };
    add('alpha', p.rootId, { type: 'wiki', lang: 'en', title: 'Alpha', description: 'First letter', collapsed: true });
    add('alphaOne', 'alpha', { type: 'header', title: 'Alpha one', collapsed: true });
    add('zurich', 'alphaOne', { type: 'wiki', lang: 'en', title: 'Zürich', description: 'Largest city in Switzerland' });
    add('alphaTwo', 'alpha', { type: 'header', title: 'Alpha two' });
    add('beta', p.rootId, { type: 'wiki', lang: 'en', title: 'Beta', description: 'Second letter', collapsed: true });
    add('blackHole', 'beta', { type: 'header', title: 'Black hole' });
    add('gamma', p.rootId, { type: 'header', title: 'Gamma', collapsed: true });
    add('huge', 'gamma', { type: 'header', title: 'An enormous heading that wraps onto two lines', scale: 8 });
    add('delta', p.rootId, { type: 'header', title: 'Delta', collapsed: true });
    add('photo', 'delta', await window.wikitree.importFile(p.id, photoPath));
    add('island', null, { type: 'header', title: 'Island', collapsed: true });
    add('lagoon', 'island', { type: 'header', title: 'Hidden lagoon' });
    await window.wikitree.saveProject(p);
    location.hash = `#/p/${p.id}`;
    return { id: p.id, root: p.rootId };
  }, photo);
  await win.waitForSelector(`.node[data-id="${fixture.root}"]`);
  await win.waitForTimeout(400);
  assert.equal(await win.locator('.node').count(), 6, 'starts with the folded branches closed');
  assert.equal(await win.locator('.tree-bottom-actions').isVisible(), false, 'bottom controls start folded');

  // ---------- Ctrl+F from far away, with the bottom controls closed ----------
  const viewport = await win.locator('.viewport').boundingBox();
  await win.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await win.mouse.wheel(0, 900);
  await win.waitForTimeout(150);
  const farZoom = await zoom();
  await win.keyboard.press('Control+f');
  assert.ok(await win.waitForSelector('.modal .node-search', { timeout: 3000 }).catch(() => null), 'Ctrl+F opens the node search');
  assert.ok(await win.evaluate(() => document.activeElement?.matches('.node-search .pop-input')), 'the search box has focus');
  await win.keyboard.press('Control+f');
  assert.equal(await win.locator('.modal-back').count(), 1, 'Ctrl+F again keeps one search open');
  await win.keyboard.type('zurich');
  await win.waitForSelector('.node-search .result');
  assert.deepEqual(await results(), ['Zürich'], 'accent-insensitive match that includes nodes inside folded branches');
  await win.keyboard.press('Enter');
  await closed();
  await settle();
  let p = saved();
  assert.deepEqual([p.nodes.alpha.collapsed, p.nodes.alphaOne.collapsed], [false, false], 'both folded ancestors are opened');
  assert.deepEqual([p.nodes.beta.collapsed, p.nodes.gamma.collapsed, p.nodes.island.collapsed], [true, true, true], 'other branches stay folded');
  let at = await placement('zurich');
  assert.ok(centred(at), `the view moves to the found node: ${JSON.stringify(at)}`);
  assert.ok(farZoom < 0.5 && await zoom() === 1, `a zoomed-out view comes in to 100%: ${farZoom} → ${await zoom()}`);
  assert.ok(await win.$eval('.node[data-id="zurich"]', (el) => el.classList.contains('flash')), 'the found node is highlighted');
  assert.deepEqual(await overlaps(win), [], 'opening the branches leaves no overlaps');
  console.log('✓ Ctrl+F finds a node two folded levels down, opens only its ancestors and centres it at 100%');

  // ---------- ranking, arrow keys ----------
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.keyboard.type('alpha');
  await win.waitForSelector('.node-search .result');
  assert.deepEqual(await results(), ['Alpha', 'Alpha one', 'Alpha two'], 'exact title first, then prefixes in tree order');
  await win.keyboard.press('ArrowDown');
  assert.equal(await win.locator('.node-search .result.sel .title').textContent(), 'Alpha one');
  await win.keyboard.press('Enter');
  await closed();
  await settle();
  assert.ok(centred(await placement('alphaOne')), 'arrow keys choose the result');
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.keyboard.type('switzerland');
  await win.waitForSelector('.node-search .result');
  assert.deepEqual(await results(), ['Zürich'], 'descriptions match too');
  await win.keyboard.type('xyz');
  await win.waitForSelector('.node-search .status:not([hidden])');
  assert.equal(await win.locator('.node-search .result').count(), 0);
  await win.keyboard.press('Escape');
  await closed();
  console.log('✓ results are ranked, chosen with the arrow keys, and match descriptions');

  // ---------- Esc changes nothing ----------
  const cameraBefore = await camera();
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.keyboard.type('black hole');
  await win.waitForSelector('.node-search .result');
  await win.keyboard.press('Escape');
  await closed();
  await settle();
  assert.equal(await camera(), cameraBefore, 'Esc leaves the view alone');
  assert.equal(saved().nodes.beta.collapsed, true, 'Esc opens nothing');
  console.log('✓ Esc closes the search without moving or opening anything');

  // ---------- the magnifier in the bottom controls ----------
  await win.click('.tree-controls-toggle');
  const button = win.locator('.tree-bottom-actions .search-btn');
  assert.ok(await button.isVisible(), 'the bottom controls have a search button');
  assert.equal(await button.locator('svg circle').count(), 1, 'it shows a magnifying glass');
  const [searchBox, historyBox] = [await button.boundingBox(), await win.locator('.tree-bottom-actions .history-btn').boundingBox()];
  assert.ok(searchBox.x + searchBox.width <= historyBox.x && Math.abs(searchBox.y - historyBox.y) < 1, 'it sits just left of History');
  await button.click();
  await win.waitForSelector('.modal .node-search');
  assert.ok(await win.evaluate(() => document.activeElement?.matches('.node-search .pop-input')), 'the button focuses the search box');
  await win.keyboard.type('lagoon');
  await win.waitForSelector('.node-search .result');
  await win.click('.node-search .result >> nth=0');
  await closed();
  await settle();
  p = saved();
  assert.equal(p.nodes.island.collapsed, false, 'a separate tree opens too');
  assert.ok(centred(await placement('lagoon')), 'clicking a result moves the view to it');
  assert.deepEqual(await overlaps(win), []);
  console.log('✓ the magnifier button opens the same search; clicking a result goes to it');

  // ---------- a node larger than the window is fitted, not cropped ----------
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.keyboard.type('enormous');
  await win.waitForSelector('.node-search .result');
  await win.keyboard.press('Enter');
  await closed();
  await settle();
  at = await placement('huge');
  assert.ok(centred(at), `an 8× node is shown whole: ${JSON.stringify(at)}`);
  assert.ok(await zoom() < 1, 'by zooming out just enough');
  assert.deepEqual(await overlaps(win), []);
  console.log('✓ a node larger than the view is fitted whole');

  // ---------- a picture inside a folded branch, shown for the first time as its branch opens ----------
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.fill('.node-search .pop-input', 'harbour');
  await win.keyboard.press('Enter');
  await closed();
  await settle();
  at = await placement('photo');
  assert.ok(centred(at), `the picture is centred: ${JSON.stringify(at)}`);
  assert.deepEqual(await overlaps(win), []);
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.modal .node-search');
  await win.keyboard.type('harbour');
  await win.waitForSelector('.node-search .result');
  assert.deepEqual(await results(), ['Harbour at dusk']);
  assert.equal(await win.locator('.node-search .result img').count(), 1, 'the result shows the picture');
  await win.keyboard.press('Escape');
  await closed();
  console.log('✓ a picture inside a folded branch is centred');

  // ---------- Cmd+F, and no search on top of another dialog ----------
  await win.keyboard.press('Meta+f');
  assert.ok(await win.waitForSelector('.modal .node-search', { timeout: 3000 }).catch(() => null), 'Cmd+F opens it as well (macOS)');
  await win.keyboard.press('Escape');
  await closed();
  await win.click('.tree-bottom-actions .history-btn');
  await win.waitForSelector('.history-dialog');
  await win.keyboard.press('Control+f');
  await win.waitForTimeout(200);
  assert.equal(await win.locator('.node-search').count(), 0, 'Ctrl+F does not open over another dialog');
  await win.keyboard.press('Escape');
  console.log('✓ Cmd+F works; Ctrl+F is ignored while another dialog is open');

  // ---------- matching rules (renderer modules, plain Node) ----------
  const { findNodes } = await import('../src/renderer/lib/node-search.js');
  const { expandAncestors } = await import('../src/renderer/lib/tree-visibility.js');
  const sample = { rootId: 'r', roots: ['r', 'x'], nodes: {
    r: { id: 'r', type: 'header', title: 'Space', parent: null, children: ['a', 'b', 'c', 'd'] },
    a: { id: 'a', type: 'wiki', title: 'Blackbird', description: 'Songbird', parent: 'r', children: [] },
    b: { id: 'b', type: 'wiki', title: 'Supermassive black hole', description: 'Largest type of black hole', parent: 'r', children: [] },
    c: { id: 'c', type: 'wiki', title: 'Black hole', description: 'Region of spacetime', parent: 'r', children: [] },
    d: { id: 'd', type: 'web', title: 'Event Horizon Telescope', url: 'https://www.eventhorizontelescope.org/', parent: 'r', children: [] },
    x: { id: 'x', type: 'header', title: 'İstanbul', parent: null, children: [] },
  } };
  assert.deepEqual(findNodes(sample, 'black hole'), ['c', 'b'], 'exact title before a match inside a title');
  assert.deepEqual(findNodes(sample, 'BLACK'), ['a', 'c', 'b'], 'prefixes in tree order, then word starts');
  assert.deepEqual(findNodes(sample, 'hole'), ['b', 'c'], 'equal ranks keep tree order');
  assert.deepEqual(findNodes(sample, 'hole black'), ['b', 'c'], 'all words, any order');
  assert.deepEqual(findNodes(sample, 'space'), ['r', 'c'], 'title matches before description matches');
  assert.deepEqual(findNodes(sample, 'eventhorizontelescope'), ['d'], 'web pages match their address');
  assert.deepEqual(findNodes(sample, 'istanbul'), ['x'], 'İ folds to i');
  assert.deepEqual([findNodes(sample, '   '), findNodes(sample, 'nothing here')], [[], []]);
  const many = { rootId: 'r', roots: ['r'], nodes: { r: { id: 'r', type: 'header', title: 'Root', parent: null, children: [] } } };
  for (let i = 0; i < 80; i++) { many.nodes[`n${i}`] = { id: `n${i}`, type: 'header', title: `Item ${i}`, parent: 'r', children: [] }; many.nodes.r.children.push(`n${i}`); }
  assert.equal(findNodes(many, 'item').length, 50, 'at most 50 results');
  const nested = { a: { id: 'a', parent: null, children: ['b'], collapsed: true }, b: { id: 'b', parent: 'a', children: ['c'], collapsed: true }, c: { id: 'c', parent: 'b', children: ['d'], collapsed: true }, d: { id: 'd', parent: 'c', children: [] } };
  assert.equal(expandAncestors(nested, 'c'), true);
  assert.deepEqual([nested.a.collapsed, nested.b.collapsed, nested.c.collapsed], [false, false, true], 'only ancestors open, not the node itself');
  assert.equal(expandAncestors(nested, 'c'), false, 'nothing to open the second time');
  console.log('✓ matching: ranks, accents, words, descriptions, web addresses, limit; ancestors only');
} finally {
  await app.close();
  if (fixture) fs.rmSync(path.join(HOME, 'projects', fixture.id), { recursive: true, force: true });
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}
finish();
