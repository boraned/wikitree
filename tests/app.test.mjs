// Online end-to-end test: main menu, picker, languages, tree editing, reader, offline save, two windows.
// Needs internet (talks to Wikipedia). Leaves its data in WIKITREE_TEST_HOME for offline.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {
  HOME, launch, check, finish, log, project, nodes, settle, fit, overlaps, pick, addToRoot, drag,
} from './helpers.mjs';

let { app, win } = await launch();

console.log('Main menu');
await win.waitForSelector('.wordmark');
check('has no project-name input', !(await win.$('input')));
check('has the green + card', !!(await win.$('.card.new-card svg')));

const theme = () => win.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, label: document.querySelector('.theme-btn')?.title }));
let look = await theme();
check('starts in dark mode with a sun button top right', look.theme === 'dark' && look.bg === 'rgb(28, 28, 30)' && look.label === 'Light mode', JSON.stringify(look));
const corner = await win.$eval('.home-theme', (b) => { const r = b.getBoundingClientRect(); return { right: innerWidth - r.right, top: r.top }; });
check('theme button sits in the top-right corner', corner.right < 30 && corner.top < 30, JSON.stringify(corner));
await win.click('.home-theme');
await win.reload();
await win.waitForSelector('.wordmark');
look = await theme();
check('light mode applies and is remembered, with a moon button', look.theme === 'light' && look.bg === 'rgb(246, 246, 247)' && look.label === 'Dark mode', JSON.stringify(look));
await win.click('.home-theme');
check('moon button returns to dark mode', (await theme()).theme === 'dark');

console.log('Picker');
await win.click('.new-card');
await win.waitForSelector('.modal');
const box = await win.$eval('.modal', (m) => {
  const r = m.getBoundingClientRect();
  return { dx: r.left + r.width / 2 - innerWidth / 2, dy: r.top + r.height / 2 - innerHeight / 2 };
});
check('is centered', Math.abs(box.dx) < 2 && Math.abs(box.dy) < 2, JSON.stringify(box));
await pick(win, { lang: 'tr', q: 'Ağaç' });
await win.waitForSelector('.node.is-root');
await win.click('.tree-controls-toggle');
check('tree view has no theme control', !(await win.$('.tree-view .theme-btn')));
check('creates a project whose first node is a Turkish article',
  (await win.$eval('.node.is-root', (e) => e.className)).includes('wiki') && project().nodes[project().rootId].lang === 'tr');

const blank = await win.$eval('.viewport', (v) => { const r = v.getBoundingClientRect(); return { x: r.left + 24, y: r.top + 24 }; });
await win.mouse.click(blank.x, blank.y, { button: 'right' });
await win.waitForSelector('.modal .picker');
await pick(win, { header: 'Independent topic' });
await settle(win, 300);
const independent = nodes().find((n) => n.title === 'Independent topic');
check('right-clicking empty canvas adds an independent project root', independent?.parent === null && project().roots.includes(independent.id));
await win.click('.tree-bottom-actions .history-btn');
await win.waitForSelector('.history-row');
const historyCorner = await win.$eval('.tree-bottom-actions .history-btn', (b) => { const r = b.getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
check('history button sits at the bottom right', historyCorner.right < 24 && historyCorner.bottom < 24, JSON.stringify(historyCorner));
const historyText = await win.$$eval('.history-summary', (e) => e.map((x) => x.textContent));
check('desktop history lists saved changes', historyText.includes('Added: Independent topic') && historyText.at(-1) === 'Project created', JSON.stringify(historyText));
check('history rows are clean and "Load older" sits below them', !(await win.textContent('.history-rows')).includes('null')
  && (await win.$eval('.history-rows', (r) => r.lastElementChild.classList.contains('history-more'))));
await win.click('.history-row:has-text("Project created") .history-open');
await win.waitForSelector('.snapshot-title');
check('desktop history previews a snapshot', (await win.$$eval('.snapshot-node', (e) => e.length)) === 1);
await win.keyboard.press('Escape');

console.log('Tree');
await addToRoot(win, { header: 'Something with a fairly long header name that needs several lines' });
const hdr = await win.$eval('.node.header:has-text("Something")', (e) => {
  const t = e.querySelector('.title');
  return { h: e.offsetHeight, overflow: getComputedStyle(t).textOverflow, fits: t.scrollWidth <= t.clientWidth + 1 };
});
check('long header wraps instead of being cut', hdr.h > 60 && hdr.overflow !== 'ellipsis' && hdr.fits, JSON.stringify(hdr));

for (const q of ['Kök', 'Yaprak', 'Orman']) await addToRoot(win, { lang: 'tr', q });
await addToRoot(win, { lang: 'en', q: 'Photosynthesis' });
await settle(win);
check('added nodes do not overlap', (await overlaps(win)).length === 0);
check('mixed-language tree shows language tags', (await win.$$eval('.lang-tag', (e) => e.map((x) => x.textContent))).includes('EN'));

let parentId = project().rootId;
for (let depth = 1; depth <= 6; depth++) {
  await fit(win);
  await win.click(`.node[data-id="${parentId}"] .add`);
  await pick(win, { header: `Layer ${depth}` });
  await settle(win, 150);
  parentId = nodes().find((n) => n.title === `Layer ${depth}`).id;
}
await win.click('.shrink-all');
await settle(win, 250);
check('Shrink all shows just the project roots', await win.$$('.tree-view .node').then((els) => els.length) === project().roots.length);
await fit(win); // visibility actions deliberately leave the camera alone
const rootId = project().rootId;
await win.click(`.node[data-id="${rootId}"] .fold[title="Expand"]`);
await settle(win, 250);
check('one Expand opens five generations', !!(await win.$('.node.header:has-text("Layer 5")')) && !(await win.$('.node.header:has-text("Layer 6")')));
await win.click('.expand-all');
await settle(win, 300);
check('Expand all reveals every node', await win.$$('.tree-view .node').then((els) => els.length) === nodes().length);

// Give "Yaprak" a child, then drop "Yaprak" onto the header: the branch moves together.
await fit(win);
await win.$eval('.node.wiki:has-text("Yaprak") .add', (b) => b.click());
await pick(win, { header: 'Child of dragged' });
await settle(win);
await fit(win);
const a = await (await win.$('.node.wiki:has-text("Yaprak")')).boundingBox();
const b = await (await win.$('.node.header:has-text("Something")')).boundingBox();
await drag(win, { x: a.x + 40, y: a.y + 20 }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
check('drop target is highlighted while dragging', !!(await win.$('.node.drop')));
await win.mouse.up();
await settle(win, 1300);
const byTitle = (t) => nodes().find((n) => n.title.startsWith(t));
check('dropping re-attaches the node (saved)', byTitle('Yaprak').parent === byTitle('Something').id);
check('its children come along', byTitle('Child of dragged').parent === byTitle('Yaprak').id && byTitle('Child of dragged').y > byTitle('Yaprak').y);
check('no overlaps after re-attaching', (await overlaps(win)).length === 0);

// Drop a node right next to the root: neighbours glide apart, new position is saved.
const before = byTitle('Photosynthesis');
const leaf = await (await win.$('.node.wiki:has-text("Photosynthesis")')).boundingBox();
const rootBox = await (await win.$('.node.is-root')).boundingBox();
await drag(win, { x: leaf.x + 30, y: leaf.y + 15 }, { x: rootBox.x + rootBox.width + 10, y: rootBox.y + 10 });
await win.mouse.up();
await settle(win, 1200);
const after = byTitle('Photosynthesis');
check('no overlaps after moving a node onto a neighbour', (await overlaps(win)).length === 0);
check('moved position is saved', Math.hypot(after.x - before.x, after.y - before.y) > 30);

// The first node moves on its own; the rest of the tree stays put.
await fit(win);
const rootBefore = nodes().find((n) => n.parent == null);
const otherBefore = byTitle('Something');
const rb = await (await win.$('.node.is-root')).boundingBox();
await drag(win, { x: rb.x + rb.width / 2, y: rb.y + 12 }, { x: rb.x + rb.width / 2 - 160, y: rb.y - 60 });
await win.mouse.up();
await settle(win, 1200);
const rootAfter = nodes().find((n) => n.parent == null);
check('first node can be moved (saved)', Math.hypot(rootAfter.x - rootBefore.x, rootAfter.y - rootBefore.y) > 60,
  `${Math.round(rootBefore.x)},${Math.round(rootBefore.y)} → ${Math.round(rootAfter.x)},${Math.round(rootAfter.y)}`);
check('moving it leaves the other nodes in place', Math.hypot(byTitle('Something').x - otherBefore.x, byTitle('Something').y - otherBefore.y) < 1);
check('dragging the first node does not open it', !!(await win.$('.tree-view')));
check('no overlaps after moving the first node', (await overlaps(win)).length === 0);

await win.hover('.node.wiki:has-text("Yaprak")');
await win.click('.node.wiki:has-text("Yaprak") .del');
await win.waitForSelector('.modal .btn-danger');
check('deleting a branch asks in-app', (await win.textContent('.modal .confirm-text')).includes('Yaprak'));
await win.click('.modal .btn-ghost');
check('cancel keeps the branch', !!(await win.$('.node.wiki:has-text("Yaprak")')));

console.log('Reader');
await win.click('.node.wiki:has-text("Orman") .title');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
check('reader has no theme control', !(await win.$('.reader .theme-btn')));
const h2 = await win.$$eval('.wiki-body h2', (e) => e.map((x) => x.textContent));
log('sections:', h2.join(' | '));
check('appendix sections removed (Turkish)', !h2.some((t) => /Ayrıca bakınız|Dış bağlantılar|Kaynakça/.test(t)));
check('Wikipedia attribution shown', (await win.textContent('.attribution')).includes('CC BY-SA'));
const link = await win.$('.wiki-body p a.wl:not(.in-tree)');
const linkTitle = await link.getAttribute('data-title');
await link.click();
await win.waitForFunction(() => document.querySelector('.crumb.cur')?.textContent !== 'Orman');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
check('a blue link opens and becomes a child', nodes().some((n) => n.parent === byTitle('Orman').id), linkTitle);
// A sentence from this (never downloaded) article must not be on disk after the app closes.
const unsavedText = (await win.$eval('.wiki-body p', (p) => p.textContent.trim())).slice(0, 60);
check('the reader has no Back button', await win.locator('.topbar .back').count() === 0);
await win.click('.crumb.parent');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
check('the parent shown top left returns to the parent article', (await win.textContent('.page-title')) === 'Orman');
check('download button is green and clickable', await win.$eval('.save-btn', (b) => b.classList.contains('ready') && !b.disabled));
await win.click('.save-btn');
await win.waitForSelector('.save-btn:disabled:not(.busy):not(.ready)', { timeout: 60000 });
check('after downloading it shows ✓ in normal colour and is not clickable',
  await win.$eval('.save-btn', (b) => b.disabled && !b.classList.contains('ready') && b.title === 'Downloaded'));
const pid = project().id;
check('download keeps the article and its images',
  fs.readdirSync(path.join(HOME, 'projects', pid, 'pages')).length === 1 && fs.readdirSync(path.join(HOME, 'projects', pid, 'media')).length > 0);
await win.click('.tree-btn');
await win.waitForSelector('.node.is-root');
await win.waitForTimeout(300);
check('tree "download all" is green while some articles are not downloaded',
  await win.$eval('.tree-view .save-btn', (b) => b.classList.contains('ready') && !b.disabled));

console.log('Two windows');
const second = await launch();
await second.win.waitForSelector('.card:not(.new-card)');
await second.win.click('.card:not(.new-card)');
await second.win.waitForSelector('.node.is-root');
await addToRoot(second.win, { header: 'From window 2' });
await settle(second.win, 500);
check('window 2 writes its change', nodes().some((n) => n.title === 'From window 2'));
await addToRoot(win, { header: 'From window 1' });
await settle(win, 500);
const titles = nodes().map((n) => n.title);
check('window 1 overwrites with its own copy', titles.includes('From window 1') && !titles.includes('From window 2'));
await second.app.close();

await addToRoot(win, { header: 'Last change before close' });
const fixtureDir = path.join(HOME, 'fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });
const markdownFile = path.join(fixtureDir, 'Attached guide.md');
fs.writeFileSync(markdownFile, '# Attached guide\n\nA **local** note.');
const imageFile = path.join(fixtureDir, 'Attached image.png');
fs.writeFileSync(imageFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxS8AAAAASUVORK5CYII=', 'base64'));
await win.click('.node.is-root .add');
await win.waitForSelector('.modal .picker');
const pickerHeights = [];
await win.waitForFunction(() => document.querySelector('.modal').getAnimations().every((a) => a.playState === 'finished'));
for (const tab of ['wiki', 'web', 'header', 'file']) {
  await win.click(`.modal .tab-${tab}`);
  pickerHeights.push(await win.evaluate(() => Math.round(document.querySelector('.modal').getBoundingClientRect().height)));
}
check('Wikipedia, web search and Header sections are the same size as Attach file', new Set(pickerHeights).size === 1, JSON.stringify(pickerHeights));
await win.click('.modal .tab-file');
check('paperclip section replaces search/header fields with file browse and drop area',
  await win.locator('.modal .input-row').isHidden() && await win.locator('.modal .dropzone').isVisible() && await win.locator('.modal .browse-files').isVisible());
const fileChooserPromise = win.waitForEvent('filechooser');
await win.click('.modal .browse-files');
await (await fileChooserPromise).setFiles([markdownFile, imageFile]);
await win.waitForSelector('.node.file');
await settle(win, 400);
check('file picker attaches multiple files as child nodes', await win.locator('.node.file').count() === 2);
check('document-node icons render as icons instead of SVG source text', await win.locator('.node.file .file-glyph svg').count() === 1);
check('image is previewed directly in the tree', await win.locator('.node.file img.file-full-image').count() === 1);
check('image nodes show the full uncropped image without a text header',
  await win.locator('.node.file.image-node .file-full-image').count() === 1
  && await win.locator('.node.file.image-node .title').count() === 0
  && await win.locator('.node.file.image-node .file-full-image').getAttribute('title') === null);
const mdNode = nodes().find((n) => n.type === 'file' && n.kind === 'markdown');
await win.locator(`.node[data-id="${mdNode.id}"] .frame-open`).click();
await settle(win, 1200);
await win.waitForSelector('.markdown-article');
check('document reader has no theme control', !(await win.$('.document-reader .theme-btn')));
check('Markdown opens in an in-app document reader', (await win.textContent('.markdown-article')).includes('A local note.'));
await win.click('.tree-btn');
await win.waitForSelector('.node.is-root');
await settle(win, 300);
await app.close();
check('a change made right before closing is kept', nodes().some((n) => n.title === 'Last change before close'));

console.log('Nothing kept after closing');
const leftovers = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (p === path.join(HOME, 'projects')) continue;
    if (e.isDirectory()) walk(p);
    else if (fs.readFileSync(p).includes(unsavedText)) leftovers.push(path.relative(HOME, p));
  }
};
walk(HOME);
check('a read-but-not-downloaded article is not on disk', leftovers.length === 0, leftovers.join(', '));
check('no cache folders in the data folder', !['cache', 'Cache', 'Code Cache'].some((d) => fs.existsSync(path.join(HOME, d))),
  fs.readdirSync(HOME).join(', '));

finish();
