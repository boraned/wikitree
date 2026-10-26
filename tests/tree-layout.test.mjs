// Layout regressions: independent trees, mixed node sizes and controls outside the cards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, launch, finish } from './helpers.mjs';

const { app, win } = await launch();
let projectId;
try {
  await win.waitForSelector('.wordmark');
  projectId = await win.evaluate(async () => {
    const p = await window.wikitree.createProject({ type: 'header', title: 'Layout fixture' });
    p.roots.push('second');
    p.nodes.second = { id: 'second', type: 'header', title: 'Independent tree', parent: null, children: [], x: 350, y: 80 };
    for (const [index, root] of p.roots.entries()) {
      for (let i = 0; i < 3; i++) {
        const id = `branch${index}${i}`;
        p.nodes[id] = { id, type: 'wiki', lang: 'en', title: `Article ${index} / ${i}`, description: 'A long description wrapping onto several lines to exercise unequal card heights.', scale: i === 1 ? 3 : 1, parent: root, children: [], x: index * 350 + i * 300, y: 260 };
        p.nodes[root].children.push(id);
      }
    }
    await window.wikitree.saveProject(p);
    location.hash = `#/p/${p.id}`;
    return p.id;
  });
  await win.waitForSelector('.node[data-id="branch12"]');
  await win.waitForTimeout(500);
  assert.equal(await win.locator('.tree-controls-toggle').count(), 1, 'bottom controls have a reveal/close button');
  assert.equal(await win.locator('.tree-bottom-actions').isVisible(), false, 'controls start folded');
  const toggleBox = await win.locator('.tree-controls-toggle').boundingBox();
  const screen = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(Math.abs(toggleBox.x + toggleBox.width / 2 - screen.width / 2) < 1 && screen.height - toggleBox.y - toggleBox.height < 2, 'toggle is at the bottom middle');
  const initialCamera = await win.$eval('.canvas', (el) => el.style.transform);
  const closedViewport = await win.locator('.viewport').boundingBox();
  await win.click('.tree-controls-toggle');
  assert.equal(await win.locator('.tree-bottom-actions').isVisible(), true);
  assert.equal(await win.locator('.tree-controls-toggle').getAttribute('aria-expanded'), 'true');
  assert.ok((await win.locator('.viewport').boundingBox()).height < closedViewport.height, 'open controls reserve space instead of covering nodes');
  await win.click('.tree-controls-toggle');
  assert.equal(await win.locator('.tree-bottom-actions').isVisible(), false);
  assert.equal(await win.locator('.tree-controls-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal((await win.locator('.viewport').boundingBox()).height, closedViewport.height);
  assert.equal(await win.$eval('.canvas', (el) => el.style.transform), initialCamera, 'drawer does not change zoom or pan');
  await win.click('.tree-controls-toggle');
  console.log('✓ bottom-centre toggle reveals and closes the controls without moving the camera');
  const collisions = () => win.$$eval('.node', (els) => {
    const footprints = els.map((el) => {
      const rects = [el, ...el.querySelectorAll('.add, .del, .fold, .lang-tag')].map((e) => e.getBoundingClientRect());
      return { id: el.dataset.id, l: Math.min(...rects.map((r) => r.left)), r: Math.max(...rects.map((r) => r.right)), t: Math.min(...rects.map((r) => r.top)), b: Math.max(...rects.map((r) => r.bottom)) };
    });
    const pairs = [];
    for (let i = 0; i < footprints.length; i++) for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i], b = footprints[j];
      if (a.l < b.r - 0.1 && b.l < a.r - 0.1 && a.t < b.b - 0.1 && b.t < a.b - 0.1) pairs.push([a.id, b.id]);
    }
    return pairs;
  });
  await win.click('.icon-btn[title="Arrange"]');
  await win.waitForTimeout(500);
  assert.deepEqual(await collisions(), [], 'Arrange separates independent trees, including node buttons');
  console.log('✓ Arrange prevents overlaps across independent trees');

  // Check the first rendered frame too: enlarging cards in place before moving them used to overlap.
  for (let i = 0; i < 10; i++) {
    await win.click('.node-size-up');
    await win.evaluate(() => new Promise(requestAnimationFrame));
    assert.deepEqual(await collisions(), [], `size increase ${i + 1} leaves no transient overlaps`);
  }
  console.log('✓ repeated size increases avoid overlaps in the first rendered frame and at large scales');
  await win.click('.icon-btn[title="Arrange"]');
  await win.waitForTimeout(400);
  assert.deepEqual(await collisions(), [], 'large node controls also stay apart after Arrange');
  if (process.env.WIKITREE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR, { recursive: true });
    await win.click('.icon-btn[title="Fit"]');
    await win.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'independent-trees-no-overlap.png') });
  }
  await win.reload();
  await win.waitForSelector('.node[data-id="branch12"]');
  await win.waitForTimeout(400);
  assert.deepEqual(await collisions(), [], 'collision-free layout survives reload');

  const camera = () => win.$eval('.canvas', (el) => el.style.transform);
  const cameraBefore = await camera();
  await win.click('.shrink-all');
  await win.waitForTimeout(100);
  assert.equal(await camera(), cameraBefore, 'Shrink all must preserve exact zoom and pan');
  assert.equal(await win.locator('.node').count(), 2);
  await win.click('.expand-all');
  await win.waitForTimeout(300);
  assert.equal(await camera(), cameraBefore, 'Expand all must preserve exact zoom and pan');
  assert.equal(await win.locator('.node').count(), 8);
  assert.deepEqual(await collisions(), []);
  console.log('✓ Expand all and Shrink all preserve exact camera zoom and pan');
} finally {
  await app.close();
  if (projectId) fs.rmSync(path.join(HOME, 'projects', projectId), { recursive: true, force: true });
}
finish();
