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
check('creates a project whose first node is a Turkish article',
  (await win.$eval('.node.is-root', (e) => e.className)).includes('wiki') && (await win.textContent('.node.is-root .title')) === 'Ağaç');

console.log('Tree');
await addToRoot(win, { header: 'Something with a fairly long header name that needs several lines' });
const hdr = await win.$eval('.node.header', (e) => {
  const t = e.querySelector('.title');
  return { h: e.offsetHeight, overflow: getComputedStyle(t).textOverflow, fits: t.scrollWidth <= t.clientWidth + 1 };
});
check('long header wraps instead of being cut', hdr.h > 60 && hdr.overflow !== 'ellipsis' && hdr.fits, JSON.stringify(hdr));

for (const q of ['Kök', 'Yaprak', 'Orman']) await addToRoot(win, { lang: 'tr', q });
await addToRoot(win, { lang: 'en', q: 'Photosynthesis' });
await settle(win);
check('added nodes do not overlap', (await overlaps(win)).length === 0);
check('mixed-language tree shows language tags', (await win.$$eval('.lang-tag', (e) => e.map((x) => x.textContent))).includes('EN'));

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
await win.click('.back');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
check('Back returns to the parent article', (await win.textContent('.page-title')) === 'Orman');
check('download button is green and clickable', await win.$eval('.save-btn', (b) => b.classList.contains('ready') && !b.disabled));
await win.click('.save-btn');
await win.waitForSelector('.save-btn:disabled:not(.busy):not(.ready)', { timeout: 60000 });
check('after downloading it shows ✓ in normal colour and is not clickable',
  await win.$eval('.save-btn', (b) => b.disabled && !b.classList.contains('ready') && b.title === 'Downloaded'));
const pid = project().id;
check('download keeps the article and its images',
  fs.readdirSync(path.join(HOME, 'projects', pid, 'pages')).length === 1 && fs.readdirSync(path.join(HOME, 'projects', pid, 'media')).length > 0);
await win.click('.icon-btn[title="Tree"]');
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
