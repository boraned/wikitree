// Image nodes can be rescaled by dragging their corner handle; the size is saved and neighbours make room.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { HOME, launch, finish, check, overlaps } from './helpers.mjs';

const dir = path.join(HOME, 'image-resize-fixtures');
fs.mkdirSync(dir, { recursive: true });
const magick = spawnSync('magick', ['-version']).error ? 'convert' : 'magick';
const files = ['Left picture.png', 'Right picture.png'].map((name, i) => {
  const file = path.join(dir, name);
  execFileSync(magick, ['-size', '240x150', `xc:${i ? '#42c968' : '#26374b'}`, file]);
  return file;
});

const { app, win } = await launch();
let projectId;
try {
  await win.waitForSelector('.wordmark');
  projectId = await win.evaluate(async (files) => {
    const p = await window.wikitree.createProject({ type: 'header', title: 'Image sizes' });
    for (const [i, file] of files.entries()) {
      const data = await window.wikitree.importFile(p.id, file);
      p.nodes[`img${i}`] = { id: `img${i}`, ...data, parent: p.rootId, children: [] };
      p.nodes[p.rootId].children.push(`img${i}`);
    }
    await window.wikitree.saveProject(p);
    location.hash = `#/p/${p.id}`;
    return p.id;
  }, files);
  await win.waitForSelector('.node[data-id="img1"] img');
  await win.locator('.file-full-image').evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
  await win.waitForTimeout(500);
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(300);
  const node = win.locator('.node[data-id="img0"]');
  const camera = await win.evaluate(() => document.querySelector('.canvas').style.transform);
  const before = await node.boundingBox();
  await node.hover();
  const handle = win.locator('.node[data-id="img0"] .node-resize');
  const shown = await win.waitForFunction(() => getComputedStyle(document.querySelector('.node[data-id="img0"] .node-resize')).opacity === '1', null, { timeout: 2000 }).then(() => true, () => false);
  check('image nodes show a corner resize handle on hover', shown && await handle.isVisible());
  const hb = await handle.boundingBox();
  const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + before.width * 0.5, start.y + before.height * 0.5, { steps: 10 });
  const during = await node.boundingBox();
  check('dragging the handle enlarges the image live from its top-left corner',
    during.width > before.width * 1.4 && Math.abs(during.x - before.x) < 2 && Math.abs(during.y - before.y) < 2
    && Math.abs(during.width / during.height - before.width / before.height) < 0.02, JSON.stringify({ before, during }));
  await win.mouse.up();
  await win.waitForTimeout(900);
  const saved = () => JSON.parse(fs.readFileSync(path.join(HOME, 'projects', projectId, 'project.json'), 'utf8'));
  await win.evaluate(async () => { const s = await import('./lib/store.js'); await s.flush(); });
  const scale = saved().nodes.img0.scale;
  check('the new size is saved on the image node', scale > 1.4 && scale < 1.6, `${scale}`);
  check('releasing the handle does not open the image', !(await win.evaluate(() => location.hash)).includes('/w/'));
  check('resizing does not move the camera', await win.evaluate(() => document.querySelector('.canvas').style.transform) === camera);
  check('the enlarged image pushes its neighbours aside instead of overlapping them', (await overlaps(win)).length === 0, JSON.stringify(await overlaps(win)));
  check('the other image keeps its own size', !saved().nodes.img1.scale || saved().nodes.img1.scale === 1);

  // Shrink far past the limit: the image stays usable.
  await node.hover();
  const hb2 = await handle.boundingBox();
  await win.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await win.mouse.down();
  await win.mouse.move(hb2.x - 2000, hb2.y - 2000, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  await win.evaluate(async () => { const s = await import('./lib/store.js'); await s.flush(); });
  check('shrinking stops at a quarter of the original size', saved().nodes.img0.scale === 0.25, `${saved().nodes.img0.scale}`);
  check('no overlaps after shrinking', (await overlaps(win)).length === 0);
  await node.hover();
  const small = await handle.boundingBox();
  check('a shrunken image keeps a full-size handle', Math.abs(small.width - hb.width) < 1.5, `${small.width} vs ${hb.width}`);
  await win.mouse.move(small.x + small.width / 2, small.y + small.height / 2);
  await win.mouse.down();
  await win.mouse.move(small.x + 200, small.y + 200, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  await win.evaluate(async () => { const s = await import('./lib/store.js'); await s.flush(); });
  check('it can be enlarged again from its smallest size', saved().nodes.img0.scale > 0.25, `${saved().nodes.img0.scale}`);
  await win.evaluate(async () => {
    const s = await import('./lib/store.js'); s.current().nodes.img0.scale = 0.25; s.changed(); await s.flush();
  });

  await win.reload();
  await win.waitForSelector('.node[data-id="img0"] img');
  await win.waitForTimeout(500);
  const ratio = await win.evaluate(() => {
    const [a, b] = ['img0', 'img1'].map((id) => document.querySelector(`.node[data-id="${id}"]`).getBoundingClientRect().width);
    return a / b;
  });
  check('the saved size survives a reload', Math.abs(ratio - 0.25) < 0.02, `${ratio}`);
  if (process.env.WIKITREE_SCREENSHOT_DIR) await win.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'image-resize.png') });
} finally {
  await app.close();
  if (projectId) fs.rmSync(path.join(HOME, 'projects', projectId), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
assert.ok(true);
finish();
