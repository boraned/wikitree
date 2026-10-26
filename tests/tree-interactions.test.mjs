// Deterministic pointer and geometry regressions, with no Wikipedia/network dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, launch, drag, overlaps, finish } from './helpers.mjs';

const { app, win } = await launch();
let fixture;
try {
  await win.waitForSelector('.wordmark');
  fixture = await win.evaluate(async () => {
    const p = await window.wikitree.createProject({ type: 'header', title: 'Old root' });
    const root = p.nodes[p.rootId];
    root.children = ['child'];
    p.label = 'Old display name';
    p.roots.push('island', 'other');
    p.nodes.child = { id: 'child', type: 'wiki', lang: 'en', title: 'Child', description: 'A readable article description', parent: root.id, children: [], x: 0, y: 180 };
    p.nodes.island = { id: 'island', type: 'header', title: 'New top', parent: null, children: ['target'], x: 420, y: 0 };
    p.nodes.target = { id: 'target', type: 'header', title: 'Drop target', parent: 'island', children: [], x: 420, y: 180 };
    // Keep promotion smaller than a snapshot so the history check exercises serialized deltas.
    p.nodes.other = { id: 'other', type: 'header', title: 'Untouched island', description: 'A lengthy article description. '.repeat(300), parent: null, children: [], x: -420, y: 0 };
    await window.wikitree.saveProject(p);
    location.hash = `#/p/${p.id}`;
    return { id: p.id, root: root.id };
  });
  await win.waitForSelector('.node[data-id="target"]');
  await win.click('.tree-controls-toggle');
  await win.waitForTimeout(500);
  const box = (id) => win.locator(`.node[data-id="${id}"]`).boundingBox();
  const from = await box(fixture.root);
  const to = await box('target');
  await drag(win, { x: from.x + from.width / 2, y: from.y + 12 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  assert.equal(await win.locator('.node[data-id="target"].drop').count(), 1, 'main root can target another node');
  await win.mouse.up();
  await win.waitForTimeout(1000);
  let saved = JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8'));
  assert.equal(saved.rootId, 'island', 'highest target ancestor becomes main root');
  assert.equal(saved.title, 'New top');
  assert.ok(!saved.label, 'old display name must not mask the new root title');
  assert.deepEqual(saved.roots, ['island', 'other']);
  assert.equal(saved.nodes[fixture.root].parent, 'target');
  assert.equal(saved.nodes.child.parent, fixture.root, 'old root retains children');
  assert.deepEqual(saved.nodes.target.children, [fixture.root]);
  assert.equal(saved.nodes.other.parent, null);
  assert.equal((await overlaps(win)).length, 0);
  console.log('✓ pointer drop promotes the highest ancestor, saves identity, and preserves other branches');
  const historyProject = await win.evaluate(async (id) => {
    const log = await window.wikitree.history(id);
    return window.wikitree.historySnapshot(id, log.entries[0].seq);
  }, fixture.id);
  assert.equal(historyProject.rootId, 'island');
  assert.ok(!historyProject.label, 'history must not resurrect the previous project name');
  console.log('✓ root promotion reconstructs correctly in history');

  // A root dropped on its own descendant must be rerooted, never form a cycle.
  const reroot = await win.evaluate(async () => {
    const store = await import('./lib/store.js');
    const p = store.current();
    const before = Object.keys(p.nodes).length;
    const result = store.reparent(p.rootId, 'child');
    await store.flush();
    return { result, before, project: await window.wikitree.project(p.id) };
  });
  assert.equal(reroot.result, true);
  saved = reroot.project;
  assert.equal(saved.rootId, 'child');
  assert.equal(saved.title, 'Child');
  assert.equal(saved.nodes.child.parent, null);
  assert.equal(saved.nodes.island.parent, 'child');
  assert.ok(!saved.nodes[fixture.root].children.includes('child'));
  assert.equal(Object.keys(saved.nodes).length, reroot.before);
  const reached = new Set();
  const visit = (id) => {
    assert.ok(!reached.has(id), `cycle or duplicate at ${id}`);
    reached.add(id);
    for (const c of saved.nodes[id].children) {
      assert.equal(saved.nodes[c].parent, id);
      visit(c);
    }
  };
  saved.roots.forEach(visit);
  assert.equal(reached.size, reroot.before);
  console.log('✓ dropping the main root within its branch reroots without cycles or lost nodes');
  await win.reload();
  await win.waitForSelector('.node[data-id="child"].is-root');
  assert.equal(await win.locator('.tree-view .node').count(), reroot.before);
  console.log('✓ promoted root survives reload');

  assert.equal(await win.locator('.node-size-up').count(), 1, 'tree has a separate node-size control');
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(400); // let the node's enter animation finish before measuring
  const geometry = () => win.$eval('.node[data-id="child"]', (el) => {
    const width = (selector) => el.querySelector(selector).getBoundingClientRect().width;
    return { node: el.getBoundingClientRect().width, title: width('.title'), desc: width('.desc'), thumb: width('.thumb'), add: width('.add'), fold: width('.fold'),
      camera: new DOMMatrix(getComputedStyle(document.querySelector('.canvas')).transform).a };
  });
  const originalSize = await geometry();
  await win.click('.node-size-up');
  await win.waitForTimeout(600);
  const bigger = await geometry();
  if (process.env.WIKITREE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR, { recursive: true });
    await win.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'tree-larger-nodes.png') });
  }
  for (const key of ['node', 'title', 'desc', 'thumb', 'add', 'fold']) {
    assert.ok(Math.abs(bigger[key] / originalSize[key] - 1.25) < 0.01, `${key} grows together: ${JSON.stringify({ originalSize, bigger })}`);
  }
  assert.equal(bigger.camera, originalSize.camera, 'node enlargement must not change camera zoom');
  assert.equal((await overlaps(win)).length, 0, 'layout accounts for enlarged node bounds');
  const sizeSnapshot = await win.evaluate(async (id) => {
    const log = await window.wikitree.history(id);
    return window.wikitree.historySnapshot(id, log.entries[0].seq);
  }, fixture.id);
  assert.equal(sizeSnapshot.nodeScale, 1.25, 'history retains whole-tree node size');
  await win.reload();
  await win.waitForSelector('.node[data-id="child"].is-root');
  await win.waitForTimeout(400);
  assert.ok(Math.abs((await geometry()).node - bigger.node) < 1, 'node size is saved');
  await win.click('.node-size-down');
  await win.waitForTimeout(400);
  assert.ok(Math.abs((await geometry()).node - originalSize.node) < 1);
  console.log('✓ node size grows text and controls independently of zoom and survives reload');

  // Right-click menu: "Remove from Parent Node" replaces the per-node size actions.
  saved = JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8'));
  const mainRoot = saved.rootId;
  const detached = Object.values(saved.nodes).find((n) => n.parent != null && n.children.length)?.id;
  const oldParent = saved.nodes[detached].parent;
  await win.locator(`.node[data-id="${mainRoot}"]`).click({ button: 'right' });
  const rootMenu = await win.locator('.ctx button').allTextContents();
  assert.ok(!rootMenu.includes('Remove from Parent Node'), 'a top-level node has no parent to leave');
  assert.ok(!rootMenu.some((t) => /Larger node|Smaller node/.test(t)), 'per-node size actions are gone');
  await win.keyboard.press('Escape');
  const beforeDetach = await box(detached);
  const countBefore = Object.keys(JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8')).nodes).length;
  await win.locator(`.node[data-id="${detached}"]`).click({ button: 'right' });
  const menu = await win.locator('.ctx button').allTextContents();
  assert.ok(menu.includes('Remove from Parent Node'), `menu offers Remove from Parent Node: ${menu}`);
  assert.ok(!menu.some((t) => /Larger node|Smaller node/.test(t)), 'per-node size actions are gone');
  await win.locator('.ctx button', { hasText: 'Remove from Parent Node' }).click();
  await win.waitForTimeout(900);
  await win.evaluate(async () => { const s = await import('./lib/store.js'); await s.flush(); });
  saved = JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8'));
  assert.equal(saved.nodes[detached].parent, null, 'the node no longer has a parent');
  assert.ok(!saved.nodes[oldParent].children.includes(detached), 'the old parent no longer lists it');
  assert.ok(saved.roots.includes(detached) && saved.rootId === mainRoot, 'it becomes a separate top-level tree; the main root is unchanged');
  assert.equal(saved.nodes[detached].children.length > 0, true, 'its branch comes along');
  assert.equal(Object.keys(saved.nodes).length, countBefore, 'no node is lost');
  const afterDetach = await box(detached);
  assert.ok(Math.abs(afterDetach.x - beforeDetach.x) < 2 && Math.abs(afterDetach.y - beforeDetach.y) < 2, 'it stays where it was');
  assert.equal((await overlaps(win)).length, 0, 'no overlaps after detaching');
  const detachLog = await win.evaluate(async (id) => (await window.wikitree.history(id)).entries[0], fixture.id);
  const restored = await win.evaluate(async ({ id, seq }) => window.wikitree.historySnapshot(id, seq), { id: fixture.id, seq: detachLog.seq });
  assert.equal(restored.nodes[detached].parent, null, 'history records the detach');
  await win.locator(`.node[data-id="${detached}"]`).click({ button: 'right' });
  assert.ok(!(await win.locator('.ctx button').allTextContents()).includes('Remove from Parent Node'), 'a detached node has no parent left to leave');
  await win.keyboard.press('Escape');
  await win.reload();
  await win.waitForSelector(`.node[data-id="${detached}"]`);
  saved = JSON.parse(fs.readFileSync(path.join(HOME, 'projects', fixture.id, 'project.json'), 'utf8'));
  assert.equal(saved.nodes[detached].parent, null, 'the detach survives reload');
  console.log('✓ right-click "Remove from Parent Node" detaches a branch in place; Larger/Smaller node are gone');

  const scale = () => win.$eval('.canvas', (el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const viewport = await win.locator('.viewport').boundingBox();
  await win.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await win.mouse.wheel(0, 3000);
  await win.waitForTimeout(100);
  const small = await scale();
  assert.ok(small < 0.02, `zoom must pass the old 15% floor: ${small}`);
  await win.mouse.wheel(0, 3000);
  await win.waitForTimeout(100);
  assert.ok(await scale() < small / 50, 'continued zoom-out must keep reducing the scale');
  console.log('✓ real wheel events continue zooming out without the old floor');

  await win.evaluate(async () => {
    const store = await import('./lib/store.js');
    for (const n of Object.values(store.current().nodes)) { n.x *= 100000; n.y *= 100000; }
    store.changed();
    await store.flush();
  });
  await win.reload();
  await win.waitForSelector('.node.is-root');
  await win.click('.icon-btn[title="Fit"]');
  assert.ok(await scale() < 0.0001, 'Fit must not stop at its old 20% floor');
  const contained = await win.$$eval('.node', (els) => {
    const v = document.querySelector('.viewport').getBoundingClientRect();
    return els.every((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom;
    });
  });
  assert.ok(contained, 'Fit contains even a very large tree');
  console.log('✓ Fit frames large trees rather than clipping them at a minimum scale');
} finally {
  await app.close();
  if (fixture) fs.rmSync(path.join(HOME, 'projects', fixture.id), { recursive: true, force: true });
}
finish();
