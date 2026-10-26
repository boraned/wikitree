import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeFixtures } from '../tools/file-types/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web-dist');
const siteBase = '/wikitree/';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.webp':'image/webp', '.jpg':'image/jpeg' };
let formatFixtureDir;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (!pathname.startsWith(siteBase)) { res.writeHead(404).end(); return; }
  const relative = pathname.slice(siteBase.length) || 'index.html';
  if (formatFixtureDir && relative.startsWith('__test-fixture/')) {
    const name = relative.slice('__test-fixture/'.length);
    if (name !== path.basename(name)) { res.writeHead(403).end(); return; }
    fs.readFile(path.join(formatFixtureDir,name),(error,data) => {
      if(error)res.writeHead(404).end();else res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store'}).end(data);
    });
    return;
  }
  const file = path.resolve(webRoot, relative);
  if (!file.startsWith(`${webRoot}${path.sep}`) && file !== path.join(webRoot, 'index.html')) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' }).end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wikitree-web-test-'));
const markdown = path.join(scratch, 'Field notes.md');
fs.writeFileSync(markdown, '# Field notes\n\nPersists on the iPad.');
const image = path.join(scratch, 'Landscape.jpg');
const { execFileSync } = await import('node:child_process');
execFileSync('magick', ['-size', '1200x800', 'gradient:#23334a-#c87849', image]);
formatFixtureDir = path.join(scratch,'formats');
const fileManifest = await makeFixtures(formatFixtureDir);
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`); if (!ok) errors.push(name); };
function readTar(buffer) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    const start = offset + 512;
    entries.set(name, buffer.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}
try {
  await page.goto(`http://127.0.0.1:${address.port}${siteBase}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wordmark');
  await page.waitForFunction(() => window.wikitree && navigator.serviceWorker.controller);
  check('PWA starts and its service worker controls the page', true);
  await page.click('.home-theme');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.wordmark');
  const lightLook = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, bar: document.querySelector('meta[name="theme-color"]').content }));
  check('web app light mode is remembered and recolours the app', lightLook.theme === 'light' && lightLook.bg === 'rgb(246, 246, 247)' && lightLook.bar === '#f6f6f7', JSON.stringify(lightLook));
  if (process.env.WIKITREE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'ios-home-light.png') });
  }
  await page.click('.home-theme');
  check('web app returns to dark mode', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  const wikipedia = await page.evaluate(async () => {
    const results = await window.wikitree.search('Earth', 'en');
    const summary = await window.wikitree.summary(results[0].title, 'en');
    const article = await window.wikitree.page(summary.title, 'en');
    return { results: results.length, summary: summary.title, article: article.html.length > 1000, thumb: summary.thumb };
  });
  check('iPad web app searches, summarizes, and reads Wikipedia over CORS', wikipedia.results > 0 && wikipedia.summary && wikipedia.article && wikipedia.thumb, JSON.stringify(wikipedia));
  await page.click('.new-card');
  const pickerHeights = [];
  await page.waitForFunction(() => document.querySelector('.modal').getAnimations().every((a) => a.playState === 'finished'));
  for (const tab of ['wiki', 'header', 'file']) {
    await page.click(`.modal .tab-${tab}`);
    pickerHeights.push(await page.evaluate(() => Math.round(document.querySelector('.modal').getBoundingClientRect().height)));
  }
  check('iPad Wikipedia and Header sections are the same size as Attach file', new Set(pickerHeights).size === 1, JSON.stringify(pickerHeights));
  await page.click('.modal .tab-header');
  await page.fill('.modal .pop-input', 'iPad field notes');
  await page.click('.modal .add-header');
  await page.waitForSelector('.node.is-root');
  check('iPad tree view has no theme control', await page.locator('.tree-view .theme-btn').count() === 0);
  check('bottom controls start collapsed on iPad', await page.locator('.tree-bottom-actions').isHidden());
  await page.tap('.tree-controls-toggle');
  check('bottom-centre button reveals the controls on touch', await page.locator('.tree-bottom-actions').isVisible());
  const projectId = new URL(page.url()).hash.match(/p\/([^/]+)/)?.[1];
  const emptySpot = await page.locator('.viewport').boundingBox();
  await page.mouse.click(emptySpot.x + 24, emptySpot.y + 24, { button: 'right' });
  await page.waitForSelector('.modal .picker');
  await page.click('.modal .tab-header');
  await page.fill('.modal .pop-input', 'Independent island');
  await page.click('.modal .add-header');
  await page.waitForSelector('.node.header');
  await page.waitForTimeout(250);
  const independentRoot = await page.evaluate(async (id) => {
    const project = await window.wikitree.project(id);
    const node = Object.values(project.nodes).find((n) => n.title === 'Independent island');
    return { independent: node?.parent === null && project.roots.includes(node.id), roots: project.roots.length };
  }, projectId);
  check('right-clicking blank canvas adds a disconnected root at that spot', independentRoot.independent && independentRoot.roots === 2);
  await page.click('.node.is-root .add');
  await page.click('.modal .tab-file');
  if (process.env.WIKITREE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'ios-attach-panel.png') });
  }
  check('file section hides the Wikipedia/Header input', await page.locator('.modal .input-row').isHidden());
  const picker = page.waitForEvent('filechooser');
  await page.click('.browse-files');
  await (await picker).setFiles([markdown, image]);
  await page.waitForSelector('.node.file');
  check('iPad-style file picker attaches documents and images', await page.locator('.node.file').count() === 2);
  const visibilityCamera = await page.locator('.canvas').evaluate((el) => el.style.transform);
  await page.click('.shrink-all');
  await page.waitForTimeout(150);
  const rootCount = await page.evaluate((id) => window.wikitree.project(id).then((p) => p.roots.length), projectId);
  check('iPad Shrink all leaves only project roots visible', await page.locator('.tree-view .node').count() === rootCount);
  check('iPad Shrink all preserves camera zoom and pan', await page.locator('.canvas').evaluate((el) => el.style.transform) === visibilityCamera);
  await page.click('.expand-all');
  await page.waitForTimeout(150);
  const nodeCount = await page.evaluate(async (id) => Object.keys((await window.wikitree.project(id)).nodes).length, projectId);
  check('iPad Expand all reveals every node', await page.locator('.tree-view .node').count() === nodeCount);
  check('iPad Expand all preserves camera zoom and pan', await page.locator('.canvas').evaluate((el) => el.style.transform) === visibilityCamera);
  await page.waitForFunction(() => document.querySelector('.file-full-image')?.naturalWidth === 1200);
  await page.click('.icon-btn[title="Fit"]');
  await page.waitForTimeout(350);
  if (process.env.WIKITREE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'ios-image-node.png') });
  check('image preserves full source dimensions and original aspect ratio', await page.$eval('.file-full-image', (img) => img.naturalWidth === 1200 && Math.abs(img.naturalWidth / img.naturalHeight - img.getBoundingClientRect().width / img.getBoundingClientRect().height) < 0.01));
  await page.waitForTimeout(300); // allow the renderer's normal autosave debounce to complete
  const markdownNode = await page.locator('.node.file').evaluateAll((els) => els.find((el) => el.querySelector('.file-kind')?.textContent === 'MARKDOWN')?.dataset.id);
  const imageNode = await page.locator('.node.image-node').getAttribute('data-id');
  const offlineCopy = await page.evaluate(async ({ projectId, imageNode }) => {
    const project = await window.wikitree.project(projectId);
    const attachment = project.nodes?.[imageNode];
    if (!attachment?.file) throw new Error(`Project ${projectId}; node ${imageNode}; nodes: ${Object.keys(project.nodes || {}).join(',')}`);
    const localImage = window.wikitree.fileUrl(projectId, attachment.file);
    const probe = await fetch(localImage);
    const savedResult = await window.wikitree.savePage({ projectId, lang: 'en', title: 'Local offline test', html: `<p>Explicitly downloaded article.</p><img src="${localImage}">`, images: [localImage], thumb: localImage, dir: 'ltr' });
    const saved = await window.wikitree.page('Local offline test', 'en', projectId);
    return { saved: saved.saved, localMedia: saved.html.includes('__media/'), fetch: probe.status, failed: savedResult.failed };
  }, { projectId, imageNode });
  check('explicitly downloaded article and its image are persisted', offlineCopy.saved && offlineCopy.localMedia, JSON.stringify(offlineCopy));
  const wikipediaImage = await page.evaluate(async ({ projectId, thumb }) => {
    const result = await window.wikitree.savePage({ projectId, lang: 'en', title: 'Wikipedia image test', html: `<p>Image offline test.</p><img src="${thumb}">`, images: [thumb], thumb, dir: 'ltr' });
    const saved = await window.wikitree.page('Wikipedia image test', 'en', projectId);
    return { downloaded: result.failed === 0, rewritten: saved.html.includes('__media/'), thumbLocal: result.thumbLocal?.includes('__media/') };
  }, { projectId, thumb: wikipedia.thumb });
  check('Wikipedia image downloads through browser CORS and is available offline', wikipediaImage.downloaded && wikipediaImage.rewritten && wikipediaImage.thumbLocal, JSON.stringify(wikipediaImage));
  const historyCheck = await page.evaluate(async (projectId) => {
    const entries = await window.wikitree.history(projectId);
    const older = await window.wikitree.historySnapshot(projectId, 1);
    const latest = await window.wikitree.historySnapshot(projectId, entries.entries[0].seq);
    return { entries: entries.entries.length, initialNodes: Object.keys(older.nodes).length, latestNodes: Object.keys(latest.nodes).length, roots: latest.roots.length, summaries: entries.entries.map((e) => e.summary) };
  }, projectId);
  check('project history records changes and reconstructs independent roots', historyCheck.entries >= 3 && historyCheck.initialNodes === 1 && historyCheck.latestNodes === 4 && historyCheck.roots === 2 && historyCheck.summaries.some((s) => s.startsWith('Added:')), JSON.stringify(historyCheck));
  const historyCorner = await page.locator('.tree-bottom-actions .history-btn').boundingBox();
  check('iPad history button sits at the bottom right', historyCorner.x + historyCorner.width > 790 && historyCorner.y + historyCorner.height > 1120, JSON.stringify(historyCorner));
  await page.click('.tree-bottom-actions .history-btn');
  await page.waitForSelector('.history-dialog .history-row');
  await page.click('.history-dialog .history-open');
  await page.waitForSelector('.history-preview .history-restore');
  check('bottom-right history log opens a snapshot preview', (await page.locator('.snapshot-title').innerText()) === 'iPad field notes');
  await page.click('.history-close');
  check('project .wt download is always available and green', await page.locator('.save-btn').evaluate((btn) => btn.classList.contains('ready') && !btn.disabled && btn.title === 'Download .wt project'));
  const downloadWait = page.waitForEvent('download');
  await page.click('.save-btn[title="Download .wt project"]');
  const wtDownload = await downloadWait;
  const wtPath = path.join(scratch, await wtDownload.suggestedFilename());
  await wtDownload.saveAs(wtPath);
  const compressed = fs.readFileSync(wtPath);
  const archive = readTar(gunzipSync(compressed));
  const manifest = JSON.parse(archive.get('manifest.json').toString());
  const archivedProject = JSON.parse(archive.get('project.json').toString());
  const archivedHistory = JSON.parse(archive.get('history.json').toString());
  check('.wt export is a compressed JSON/TAR bundle containing project, files and history',
    wtDownload.suggestedFilename().endsWith('.wt') && archivedProject.id === projectId && archivedProject.roots.length === 2 && manifest.files.length === 2
      && manifest.pages.length === 2 && manifest.media.length >= 2 && archivedHistory.length >= 2,
    `${wtDownload.suggestedFilename()} files=${manifest.files.length} pages=${manifest.pages.length} media=${manifest.media.length} history=${archivedHistory.length}`);
  const obsidianWait = page.waitForEvent('download');
  await page.click('.obsidian-export');
  const obsidianDownload = await obsidianWait;
  const obsidianPath = path.join(scratch, await obsidianDownload.suggestedFilename());
  await obsidianDownload.saveAs(obsidianPath);
  const obsidianNote = fs.readFileSync(obsidianPath, 'utf8');
  check('Obsidian option downloads an openable Markdown tree note',
    obsidianDownload.suggestedFilename().endsWith('.md') && obsidianNote.includes('# iPad field notes')
      && obsidianNote.includes('Independent island') && obsidianNote.includes('wikitree_project:'));
  const revisions = await page.evaluate(async () => {
    const project = await window.wikitree.createProject({ type: 'header', title: 'Revision test' });
    for (let i = 1; i <= 55; i++) {
      const id = `revision${String(i).padStart(4, '0')}`;
      project.nodes[id] = { id, type: 'wiki', title: `Article ${i}`, lang: 'en', parent: project.rootId, children: [], x: i * 300, y: 150 };
      project.nodes[project.rootId].children.push(id);
      await window.wikitree.saveProject(project);
    }
    const changes = await window.wikitree.history(project.id, Infinity, 100);
    const at21 = await window.wikitree.historySnapshot(project.id, 21);
    const snapshots = changes.entries.filter((entry) => entry.snapshot).length;
    await window.wikitree.restoreSnapshot(project.id, 21);
    const restored = await window.wikitree.project(project.id);
    return { changes: changes.entries.length, snapshots, earlierNodes: Object.keys(at21.nodes).length, restoredNodes: Object.keys(restored.nodes).length };
  });
  check('55 node saves create separate compact revisions with size-based snapshots and restore correctly',
    revisions.changes === 56 && revisions.snapshots >= 2 && revisions.snapshots <= 10 && revisions.earlierNodes === 21 && revisions.restoredNodes === 21, JSON.stringify(revisions));
  await page.locator(`.node[data-id="${markdownNode}"] .frame-open`).click();
  await page.waitForSelector('.markdown-article');
  check('Markdown opens inside the app', (await page.locator('.markdown-article').innerText()).includes('Persists on the iPad.'));
  await page.click('.tree-btn');
  await page.waitForSelector('.node.is-root');
  await page.click('.icon-btn[title="Projects"]');
  await page.waitForSelector('.card:not(.new-card)');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.card:not(.new-card)');
  const savedProjectCard = page.locator('.card:not(.new-card)').filter({ hasText: 'iPad field notes' });
  check('project data and attached files survive a full reload', await savedProjectCard.locator('.card-title').innerText() === 'iPad field notes');
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.card:not(.new-card)');
  await page.locator('.card:not(.new-card)').filter({ hasText: 'iPad field notes' }).click();
  await page.waitForSelector(`.node[data-id="${imageNode}"] .file-full-image`);
  check('service-worker shell and IndexedDB attachments remain available offline', await page.locator(`.node[data-id="${imageNode}"] .file-full-image`).evaluate((img) => img.complete && img.naturalWidth === 1200));
  const offlineArticle = await page.evaluate(async (id) => window.wikitree.page('Local offline test', 'en', id), projectId);
  check('downloaded article and local media still load offline after restart', offlineArticle.saved && offlineArticle.html.includes('__media/'));

  await page.waitForTimeout(400);
  const imageSize = () => page.locator(`.node[data-id="${imageNode}"] .file-full-image`).evaluate((el) => el.getBoundingClientRect().width);
  const originalImageSize = await imageSize();
  const cameraScale = () => page.locator('.canvas').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  const originalCamera = await cameraScale();
  await page.click('.node-size-up');
  await page.waitForTimeout(400);
  check('PWA node-size control enlarges images without changing camera zoom', Math.abs(await imageSize() / originalImageSize - 1.25) < 0.01 && await cameraScale() === originalCamera);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.node.image-node');
  await page.waitForTimeout(400);
  check('PWA node size survives offline reload', Math.abs(await imageSize() / originalImageSize - 1.25) < 0.01);
  await page.locator(`.node[data-id="${imageNode}"]`).click({ button: 'right' });
  const ctx = await page.locator('.ctx button').allTextContents();
  check('PWA node menu offers Remove from Parent Node, without Larger/Smaller node', ctx.includes('Remove from Parent Node') && !ctx.some((t) => /Larger node|Smaller node/.test(t)), JSON.stringify(ctx));
  await page.keyboard.press('Escape');

  const rootFixture = await page.evaluate(async () => {
    const store = await import('./lib/store.js');
    await store.flush();
    const p = await window.wikitree.createProject({ type: 'header', title: 'Previous root' });
    p.roots.push('newtop');
    p.nodes.newtop = { id: 'newtop', type: 'header', title: 'Promoted topic', parent: null, children: ['newparent'], x: 400, y: 0 };
    p.nodes.newparent = { id: 'newparent', type: 'header', title: 'Parent', parent: 'newtop', children: [], x: 400, y: 180 };
    await window.wikitree.saveProject(p);
    location.hash = `#/p/${p.id}`;
    return { id: p.id, root: p.rootId };
  });
  await page.waitForSelector('.node[data-id="newparent"]');
  await page.waitForTimeout(400);
  const oldRootBox = await page.locator(`.node[data-id="${rootFixture.root}"]`).boundingBox();
  const parentBox = await page.locator('.node[data-id="newparent"]').boundingBox();
  await page.mouse.move(oldRootBox.x + oldRootBox.width / 2, oldRootBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const promoted = await page.evaluate((id) => window.wikitree.project(id), rootFixture.id);
  check('PWA root drag promotes the highest ancestor and saves the new project identity', promoted.rootId === 'newtop' && promoted.title === 'Promoted topic' && promoted.nodes[rootFixture.root].parent === 'newparent' && promoted.roots.length === 1);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.node[data-id="newtop"].is-root');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('.icon-btn[title="Fit"]');
  await page.waitForTimeout(400);
  const footerFits = await page.locator('.tree-bottom-actions').evaluate((el) => {
    const rects = [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    return rects.every((r, i) => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (i === 0 || r.left >= rects[i - 1].right));
  });
  check('node-size and history controls fit an iPhone-width footer', footerFits);
  if (process.env.WIKITREE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'ios-size-controls.png') });
  await page.tap('.tree-controls-toggle');
  check('bottom-centre button closes controls on touch', await page.locator('.tree-bottom-actions').isHidden());
  const toggleCentered = await page.locator('.tree-controls-toggle').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 1 && innerHeight - r.bottom < 2;
  });
  check('closed drawer toggle stays at the bottom middle on iPhone', toggleCentered);
  if (process.env.WIKITREE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.WIKITREE_SCREENSHOT_DIR, 'ios-controls-closed.png') });
  const zoomViewport = await page.locator('.viewport').boundingBox();
  await page.mouse.move(zoomViewport.x + zoomViewport.width / 2, zoomViewport.y + zoomViewport.height / 2);
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(150);
  const firstZoom = await cameraScale();
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(150);
  const mobileZoom = await cameraScale();
  check('PWA wheel zoom keeps shrinking below the old minimum scale', firstZoom < 0.02 && mobileZoom < firstZoom / 50, JSON.stringify({ firstZoom, mobileZoom, zoomViewport }));
  await page.context().setOffline(false);
  const formatsProject = await page.evaluate(() => window.wikitree.createProject({type:'header',title:'PWA format checks'}));
  const formatResults = [];
  for (const fixture of [...fileManifest.fixtures,...fileManifest.rejected.map((file)=>({path:file}))]) {
    const name = path.basename(fixture.path);
    const expected = fixture.ext && fixture.ext!=='ogv' ? fixture.kind : name.endsWith('.html') ? 'code' : 'unsupported';
    const result = await page.evaluate(async ({projectId,name}) => {
      const blob = await (await fetch(`./__test-fixture/${encodeURIComponent(name)}`)).blob();
      try { const node = await window.wikitree.importFile(projectId,new File([blob],name)); return {accepted:true,...node}; }
      catch(error) { return {accepted:false,error:error.message}; }
    }, {projectId:formatsProject.id,name});
    formatResults.push({name,expected,...result});
    check(`PWA imports ${name} as ${expected}`,result.accepted && result.kind===expected,JSON.stringify(result));
  }
  const persisted = await page.evaluate(async (id) => {
    const db = await new Promise((resolve,reject) => {const request=indexedDB.open('wikitree-ios');request.onsuccess=()=>resolve(request.result);request.onerror=reject;});
    try { return await new Promise((resolve,reject) => {const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result.filter((f)=>f.projectId===id).length);request.onerror=reject;}); }
    finally { db.close(); }
  },formatsProject.id);
  check('PWA preserves all 44 sample files, including unsupported inputs',persisted===44,`${persisted}`);
  fs.writeFileSync(path.join(scratch,'format-results.json'),JSON.stringify(formatResults,null,2));

  const inspectorProject = await page.evaluate(async (id) => {
    const p = await window.wikitree.project(id);
    const files = [new File([new Uint8Array([0,65,127,255,10])],'opaque.custom'),new File(['def hello(name):\n    return "Hello " + name\n'],'Example.py')];
    for(const [i,file] of files.entries()) {
      const data = await window.wikitree.importFile(id,file);
      const key = i===0 ? 'opaque' : 'source';p.nodes[key]={id:key,...data,parent:p.rootId,children:[]};p.nodes[p.rootId].children.push(key);
    }
    await window.wikitree.saveProject(p);location.hash=`#/p/${id}`;return p;
  },formatsProject.id);
  await page.waitForSelector('.node[data-id="opaque"]');
  check('PWA labels unsupported file below its full filename',await page.locator('.node[data-id="opaque"] .title').textContent()==='opaque.custom' && await page.locator('.node[data-id="opaque"] .file-kind').textContent()==='Unsupported file');
  await page.click('.icon-btn[title="Fit"]');
  await page.tap('.node[data-id="opaque"] .frame-open');
  await page.waitForSelector('.byte-view');
  check('PWA hex viewer shows actual file bytes',(await page.locator('.byte-view').textContent()).includes('00 41 7f ff 0a'));
  await page.selectOption('.file-view-mode','binary');
  await page.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.includes('01000001'));
  check('PWA binary viewer shows the same bytes as bits',true);
  await page.evaluate(id=>location.hash=`#/p/${id}/w/source`,formatsProject.id);
  await page.waitForSelector('.source-code .hljs-keyword');
  await page.context().setOffline(true);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForSelector('.source-code .hljs-keyword');
  check('source highlighting and all language options work offline',await page.locator('.code-language option').count()>=190 && (await page.locator('.source-code').textContent()).includes('def hello'));
  await page.context().setOffline(false);
  const videoData=formatResults.find(r=>r.name==='MP4 sample.mp4');
  await page.evaluate(async ({id,video})=>{
    const store=await import('./lib/store.js');const p=store.current();
    p.nodes.movie={id:'movie',...video,parent:p.rootId,children:[]};p.nodes[p.rootId].children.push('movie');store.changed();await store.flush();location.hash=`#/p/${id}`;
  },{id:formatsProject.id,video:videoData});
  await page.waitForSelector('.node[data-id="movie"] video');
  await page.waitForTimeout(300);
  check('PWA video preview does not autoplay',await page.locator('.node[data-id="movie"] video').evaluate(v=>v.paused&&v.currentTime===0&&!v.autoplay));
  await page.click('.icon-btn[title="Fit"]');
  await page.tap('.node[data-id="movie"] .frame-open');
  await page.waitForSelector('.video-player');
  check('enlarged PWA video starts paused',await page.locator('.video-player').evaluate(v=>v.paused));
  check('no separate Play button on PWA videos', await page.locator('.media-play').count() === 0);
  await page.locator('.video-player').evaluate((v) => v.play());
  await page.waitForFunction(()=>document.querySelector('.video-player')?.currentTime>0.1);
  await page.tap('.file-fullscreen');
  await page.waitForFunction(()=>document.fullscreenElement!=null);
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>document.fullscreenElement==null);
  check('PWA video plays on touch and enters/exits fullscreen',true);
  await page.evaluate(id=>location.hash=`#/p/${id}`,rootFixture.id);
  await page.waitForSelector('.node[data-id="newtop"]');
  await page.evaluate((id) => window.wikitree.deleteProject(id),formatsProject.id);
  if (errors.length) console.error('Browser errors:', errors);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
if (errors.length) process.exit(1);
