// Live previews: web search/links in the picker, web pages and every attachment viewable, rescalable and
// fullscreen in the overview, and the reader's parent › current → children bar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { HOME, launch, finish, check, overlaps } from './helpers.mjs';
import { makeFixtures } from '../tools/file-types/fixtures.mjs';

// A page that refuses to be framed and only shows its text when JavaScript runs.
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'; default-src 'self' 'unsafe-inline'",
  });
  res.end('<!doctype html><title>Local test page</title><body><p id="out">no script</p><script>document.getElementById("out").textContent = "JavaScript ran " + (6 * 7);</script></body>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/page`;
const shots = process.env.WIKITREE_SCREENSHOT_DIR;
const shot = async (win, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await win.screenshot({ path: path.join(shots, `${name}.png`) }); } };

const dir = process.env.WIKITREE_FILE_FIXTURES || path.join(HOME, 'file-type-fixtures');
const { fixtures } = fs.existsSync(path.join(dir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))) : await makeFixtures(dir);
const sample = (ext) => fixtures.find((f) => f.ext === ext).path;

const { app, win } = await launch();
let projectId;
const frameFor = async (prefix) => {
  for (let i = 0; i < 80; i++) {
    const f = win.frames().find((x) => x.url().startsWith(prefix));
    if (f) return f;
    await win.waitForTimeout(100);
  }
  return null;
};
try {
  await win.waitForSelector('.wordmark');
  projectId = await win.evaluate(async () => (await window.wikitree.createProject({ type: 'header', title: 'Live previews' })).id);
  await win.evaluate((id) => { location.hash = `#/p/${id}`; }, projectId);
  await win.waitForSelector('.node.is-root');

  // ---------- picker: four icon sections ----------
  await win.click('.node.is-root .add');
  await win.waitForSelector('.modal .picker');
  const tabs = await win.$$eval('.modal .tab', (els) => els.map((e) => ({ label: e.getAttribute('aria-label'), text: e.textContent.trim(), svg: !!e.querySelector('svg') })));
  check('picker sections are Wikipedia, web search, header and attach file, in that order',
    JSON.stringify(tabs.map((t) => t.label)) === JSON.stringify(['Wikipedia', 'Search the web', 'Header', 'Attach file']), JSON.stringify(tabs));
  check('section titles are icons only', await win.$$eval('.modal .tab', (els) => els.every((e) => e.children.length === 1 && e.firstElementChild.tagName === 'svg' && [...e.childNodes].every((c) => c.nodeType === 1))), JSON.stringify(tabs));
  await win.click('.modal .tab-web');
  check('web section asks for a search or a link', (await win.getAttribute('.modal .pop-input', 'placeholder')).includes('paste a link'));
  await win.fill('.modal .pop-input', 'binary tree data structure');
  const searched = await win.waitForSelector('.modal .result.web-result', { timeout: 20000 }).then(() => true, () => false);
  const firstResult = searched ? await win.locator('.modal .result.web-result .url').first().textContent() : '';
  check('web search lists pages from the internet', searched && firstResult.length > 3, await win.locator('.modal .status').textContent().catch(() => ''));
  await shot(win, 'picker-web-search');
  // Pasting a link opens it straight away.
  await win.fill('.modal .pop-input', '');
  await win.evaluate((url) => {
    const data = new DataTransfer();
    data.setData('text/plain', url);
    document.querySelector('.modal .pop-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, pageUrl);
  await win.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
  const webNode = await win.evaluate(async () => { const s = await import('./lib/store.js'); await s.flush(); return Object.values(s.current().nodes).find((n) => n.type === 'web'); });
  check('pasting a link adds that page with its own title', webNode?.url === pageUrl && webNode?.title === 'Local test page', JSON.stringify(webNode));

  // ---------- web page live in the overview ----------
  await win.waitForSelector(`.node[data-id="${webNode.id}"] iframe.web-frame`);
  const frame = await frameFor(pageUrl);
  check('the page loads in the overview even though it forbids framing', !!frame);
  const ran = frame && await frame.waitForFunction(() => document.getElementById('out')?.textContent === 'JavaScript ran 42', null, { timeout: 10000 }).then(() => true, () => false);
  check('the page runs its own JavaScript', ran);
  check('the page cannot reach the app', frame && await frame.evaluate(() => { try { return typeof window.parent.wikitree; } catch { return 'blocked'; } }) === 'blocked');
  check('the app itself gets no web bridge inside the page', frame && await frame.evaluate(() => typeof window.wikitree) === 'undefined');

  // ---------- every attachment in the overview ----------
  const kinds = ['pdf', 'docx', 'md', 'txt', 'py', 'mp4', 'mp3', 'png'];
  fs.writeFileSync(path.join(dir, 'Example.py'), 'def hello():\n    return "tree"\n');
  const nodeIds = await win.evaluate(async ({ id, files }) => {
    const s = await import('./lib/store.js');
    const ids = {};
    for (const [ext, file] of files) ids[ext] = s.addNode(s.current().rootId, await window.wikitree.importFile(id, file)).id;
    s.changed(); await s.flush();
    return ids;
  }, { id: projectId, files: kinds.map((ext) => [ext, ext === 'py' ? path.join(dir, 'Example.py') : sample(ext)]) });
  await win.evaluate((id) => { location.hash = '#/'; setTimeout(() => { location.hash = `#/p/${id}`; }, 50); }, projectId);
  await win.waitForSelector(`.node[data-id="${nodeIds.docx}"] section.docx`, { timeout: 20000 });
  await win.waitForSelector(`.node[data-id="${nodeIds.py}"] .source-code .hljs-keyword`);
  await win.waitForSelector(`.node[data-id="${nodeIds.md}"] .markdown-article`);
  await win.click('.icon-btn[title="Arrange"]');
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(1200);
  await shot(win, 'overview-live-previews');
  const inOverview = await win.evaluate((ids) => {
    const q = (id, sel) => !!document.querySelector(`.node[data-id="${id}"] ${sel}`);
    return { pdf: q(ids.pdf, '.frame-body iframe.pdf-frame'), word: q(ids.docx, '.frame-body section.docx'), md: q(ids.md, '.frame-body .markdown-article'),
      txt: q(ids.txt, '.frame-body .text-document'), py: q(ids.py, '.frame-body .source-code'), mp4: q(ids.mp4, '.frame-body video[controls]'),
      mp3: q(ids.mp3, '.frame-body audio[controls]'), png: q(ids.png, 'img.file-full-image') };
  }, nodeIds);
  check('PDF, Word, Markdown, text, source, video, audio and images are all viewable in the overview', Object.values(inOverview).every(Boolean), JSON.stringify(inOverview));
  check('no overlaps between live previews', (await overlaps(win)).length === 0, JSON.stringify(await overlaps(win)));
  const video = await win.evaluate((id) => { const v = document.querySelector(`.node[data-id="${id}"] video`); return { paused: v.paused, autoplay: v.autoplay }; }, nodeIds.mp4);
  check('videos do not play by themselves', video.paused && !video.autoplay);
  check('there is no separate Play button on videos', await win.locator('.media-play').count() === 0);
  check('every live preview has fullscreen and resize controls',
    await win.evaluate(() => [...document.querySelectorAll('.node.frame-node, .node.image-node')].every((n) => n.querySelector('.frame-fullscreen') && n.querySelector('.node-resize'))));

  // Previews are cards on the canvas until clicked; then they take the pointer.
  const cam0 = await win.$eval('.canvas', (el) => el.style.transform);
  const wordBody = await win.locator(`.node[data-id="${nodeIds.docx}"] .frame-body`).boundingBox();
  await win.mouse.move(wordBody.x + wordBody.width / 2, wordBody.y + wordBody.height / 2);
  await win.mouse.wheel(0, -120);
  await win.waitForTimeout(200);
  check('the mouse wheel over an inactive preview zooms the overview', await win.$eval('.canvas', (el) => el.style.transform) !== cam0);
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(300);
  const wb = await win.locator(`.node[data-id="${nodeIds.docx}"] .frame-body`).boundingBox();
  await win.mouse.click(wb.x + wb.width / 2, wb.y + wb.height / 2);
  check('clicking a preview makes it live without opening it', await win.locator(`.node[data-id="${nodeIds.docx}"].live`).count() === 1 && !(await win.evaluate(() => location.hash)).includes('/w/'));
  const cam1 = await win.$eval('.canvas', (el) => el.style.transform);
  await win.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await win.mouse.wheel(0, 300);
  await win.waitForTimeout(300);
  const scrolled = await win.$eval(`.node[data-id="${nodeIds.docx}"] .document-content.word`, (el) => el.scrollTop);
  check('a live preview scrolls its own content instead of zooming', scrolled > 0 && await win.$eval('.canvas', (el) => el.style.transform) === cam1, `${scrolled}`);
  await win.keyboard.press('Escape');
  check('Esc releases the live preview', await win.locator('.node.live').count() === 0);

  // Fullscreen from the overview.
  for (const [id, expected] of [[nodeIds.mp4, 'VIDEO'], [webNode.id, 'IFRAME'], [nodeIds.docx, 'DIV'], [nodeIds.png, 'IMG']]) {
    await win.locator(`.node[data-id="${id}"]`).hover();
    await win.click(`.node[data-id="${id}"] .frame-fullscreen`);
    const full = await win.waitForFunction(() => document.fullscreenElement, null, { timeout: 4000 }).then(() => win.evaluate(() => {
      const r = document.fullscreenElement.getBoundingClientRect();
      return { tag: document.fullscreenElement.tagName, fills: Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2 };
    }), () => null);
    check(`${expected === 'DIV' ? 'a Word document' : expected === 'IFRAME' ? 'a web page' : expected === 'IMG' ? 'an image' : 'a video'} goes fullscreen from the overview`, full?.tag === expected && full.fills, JSON.stringify(full));
    if (expected === 'IFRAME') await shot(win, 'web-fullscreen');
    await win.evaluate(() => document.exitFullscreen());
    await win.waitForFunction(() => !document.fullscreenElement);
  }

  // Rescale a web page from its corner.
  const camera = await win.$eval('.canvas', (el) => el.style.transform);
  const node = win.locator(`.node[data-id="${webNode.id}"]`);
  await node.hover();
  const before = await node.boundingBox();
  const handle = await win.locator(`.node[data-id="${webNode.id}"] .node-resize`).boundingBox();
  await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await win.mouse.down();
  await win.mouse.move(handle.x + before.width * 0.4, handle.y + before.height * 0.4, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(900);
  const scaled = await win.evaluate(async (id) => { const s = await import('./lib/store.js'); await s.flush(); return s.current().nodes[id].scale; }, webNode.id);
  check('web pages rescale from their corner handle and the size is saved', scaled > 1.3 && scaled < 1.5, `${scaled}`);
  check('rescaling leaves the camera alone and the page keeps running', await win.$eval('.canvas', (el) => el.style.transform) === camera
    && await (await frameFor(pageUrl)).evaluate(() => document.getElementById('out').textContent) === 'JavaScript ran 42');
  check('no overlaps after rescaling', (await overlaps(win)).length === 0);

  // Dragging by the bar still moves the node.
  const bar = await win.locator(`.node[data-id="${nodeIds.txt}"] .frame-bar .title`).boundingBox();
  const startX = await win.evaluate(async (id) => (await import('./lib/store.js')).current().nodes[id].x, nodeIds.txt);
  await win.mouse.move(bar.x + 10, bar.y + 5);
  await win.mouse.down();
  await win.mouse.move(bar.x + 40, bar.y + 25, { steps: 4 });
  await win.mouse.move(bar.x + 160, bar.y + 25, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const endX = await win.evaluate(async (id) => (await import('./lib/store.js')).current().nodes[id].x, nodeIds.txt);
  check('a preview is moved by dragging its bar', Math.abs(endX - startX) > 40, `${startX} → ${endX}`);
  check('dragging a preview does not open it', !(await win.evaluate(() => location.hash)).includes('/w/'));

  // ---------- enlarged web page ----------
  await win.click(`.node[data-id="${webNode.id}"] .frame-open`);
  await win.waitForSelector('.reader-preview iframe.web-frame');
  check('the enlarged page has no Back button; the tree button returns to the overview', await win.locator('.topbar .back').count() === 0 && await win.locator('.topbar .tree-btn').count() === 1);
  check('the enlarged page shows its address, reload and fullscreen', (await win.locator('.web-address').textContent()) === '127.0.0.1' && await win.locator('.web-reload').count() === 1 && await win.locator('.file-fullscreen').count() === 1);
  await win.click('.topbar .tree-btn');
  await win.waitForSelector(`.node[data-id="${webNode.id}"]`);

  // ---------- reader bar: parent › current, arrows down to the children ----------
  const family = await win.evaluate(async () => {
    const s = await import('./lib/store.js');
    const root = s.current().rootId;
    const mid = s.addNode(root, { type: 'wiki', title: 'Tree', lang: 'en', description: '' });
    for (const t of ['Plant', 'Tree (graph theory)', 'Wood']) s.addNode(mid.id, { type: 'wiki', title: t, lang: 'en', description: '' });
    s.changed(); await s.flush();
    return mid.id;
  });
  await win.evaluate(({ p, id }) => { location.hash = `#/p/${p}/w/${id}`; }, { p: projectId, id: family });
  await win.waitForSelector('.crumbs.family .crumb.kid');
  await win.waitForTimeout(300);
  const bar2 = await win.evaluate(() => {
    const nav = document.querySelector('.crumbs.family');
    const kids = [...nav.querySelectorAll('.crumb.kid')];
    const cur = nav.querySelector('.crumb.cur').getBoundingClientRect();
    const svg = nav.querySelector('.family-arrows');
    const heads = [...svg.querySelectorAll('.family-head')].map((p) => p.getBoundingClientRect());
    const line = svg.querySelector('.family-line').getBoundingClientRect();
    return {
      back: document.querySelectorAll('.topbar .back').length,
      parent: nav.querySelector('.crumb.parent')?.textContent, current: nav.querySelector('.crumb.cur').textContent,
      kids: kids.map((k) => k.textContent),
      kidsRight: kids.every((k) => k.getBoundingClientRect().left > cur.right),
      headsAboveKids: heads.length === kids.length && heads.every((hd, i) => hd.bottom <= kids[i].getBoundingClientRect().top + 2 && Math.abs((hd.left + hd.right) / 2 - (kids[i].getBoundingClientRect().left + Math.min(kids[i].offsetWidth / 2, 18))) < 3),
      lineAbove: line.top < Math.min(...kids.map((k) => k.getBoundingClientRect().top)),
      lineFromCurrent: Math.abs(line.left - cur.right) < 12,
      crumbsTotal: nav.querySelectorAll('.crumb').length,
    };
  });
  check('the reader has no Back button', bar2.back === 0);
  check('top left shows only the parent, then the current page', bar2.parent === 'Live previews' && bar2.current === 'Tree' && bar2.crumbsTotal === 2 + bar2.kids.length, JSON.stringify(bar2));
  check('the children are listed to the right of the current page', JSON.stringify(bar2.kids) === JSON.stringify(['Plant', 'Tree (graph theory)', 'Wood']) && bar2.kidsRight, JSON.stringify(bar2));
  check('an arrow runs from the current page above the children and points down to each', bar2.lineFromCurrent && bar2.lineAbove && bar2.headsAboveKids, JSON.stringify(bar2));
  await shot(win, 'reader-family-bar');
  const many = await win.evaluate(async (id) => {
    const s = await import('./lib/store.js');
    for (let i = 0; i < 14; i++) s.addNode(id, { type: 'wiki', title: `Long child article number ${i}`, lang: 'en', description: '' });
    s.changed(); await s.flush();
    const pid = location.hash.split('/')[2];
    location.hash = `#/p/${pid}`;
    await new Promise((r) => setTimeout(r, 400));
    location.hash = `#/p/${pid}/w/${id}`;
    await new Promise((r) => setTimeout(r, 900));
    const cur = document.querySelector('.crumbs.family .crumb.cur'), par = document.querySelector('.crumbs.family .crumb.parent');
    const strip = document.querySelector('.family-strip');
    const buttons = document.querySelector('.topbar .save-btn').getBoundingClientRect();
    return { curFull: cur.scrollWidth <= cur.clientWidth, parFull: par.scrollWidth <= par.clientWidth, scrolls: strip.scrollWidth > strip.clientWidth, clear: strip.getBoundingClientRect().right <= buttons.left };
  }, family);
  check('with many children the parent and current names stay whole and the children scroll', many.curFull && many.parFull && many.scrolls && many.clear, JSON.stringify(many));
  await win.click('.crumbs.family .crumb.kid >> text=Wood');
  await win.waitForFunction(() => document.querySelector('.crumbs.family .crumb.cur')?.textContent === 'Wood');
  check('clicking a child opens it, with this page as its parent', await win.locator('.crumbs.family .crumb.parent').textContent() === 'Tree');
  await win.click('.crumbs.family .crumb.parent');
  await win.waitForFunction(() => document.querySelector('.crumbs.family .crumb.cur')?.textContent === 'Tree');
  await win.click('.topbar .tree-btn');
  await win.waitForSelector('.node.is-root');
  check('the tree button returns to the overview', !(await win.evaluate(() => location.hash)).includes('/w/'));
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
  if (projectId) fs.rmSync(path.join(HOME, 'projects', projectId), { recursive: true, force: true });
}
assert.ok(true);
finish();
