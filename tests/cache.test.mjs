// Article-cache size cap: least-recently-used entries go first, saved articles are never touched,
// and the article just opened always stays. Runs the app with a 1 MB cap. Needs internet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, launch, check, finish, project } from './helpers.mjs';

const CACHE = path.join(HOME, 'cache', 'pages');
const LIMIT = 1024 * 1024;
process.env.WIKITREE_CACHE_MB = '1';

// Ten fake 300 KB entries, last used 10…1 days ago (fake-0 is the oldest).
fs.mkdirSync(CACHE, { recursive: true });
const day = 24 * 3600 * 1000;
const fakes = Array.from({ length: 10 }, (_, i) => {
  const file = path.join(CACHE, `fake-${i}.json`);
  fs.writeFileSync(file, JSON.stringify({ title: `fake ${i}`, lang: 'en', html: 'x'.repeat(300 * 1024) }));
  const t = new Date(Date.now() - (10 - i) * day);
  fs.utimesSync(file, t, t);
  return file;
});
const size = () => fs.readdirSync(CACHE).reduce((s, f) => s + fs.statSync(path.join(CACHE, f)).size, 0);
const p = project();
const savedDir = path.join(HOME, 'projects', p.id, 'pages');
const savedBefore = fs.readdirSync(savedDir);

const { app, win } = await launch();
await win.waitForSelector('.card:not(.new-card)');
await win.waitForTimeout(1500);

const kept = fakes.map((f) => fs.existsSync(f));
check('cache trimmed under the cap at startup', size() <= LIMIT, `${Math.round(size() / 1024)} KB`);
check('oldest entries removed first', kept.every((k, i) => !k || kept.slice(i).every(Boolean)), JSON.stringify(kept));
check('saved articles untouched', JSON.stringify(fs.readdirSync(savedDir)) === JSON.stringify(savedBefore));

// Opening an article caches it, and pruning never removes the one just opened.
await win.click('.card:not(.new-card)');
await win.waitForSelector('.node.is-root');
await win.click('.node.is-root .title');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
await win.waitForTimeout(1000);
const root = p.nodes[p.rootId];
const file = path.join(CACHE, `${crypto.createHash('sha1').update(`${root.lang}:${root.title.replace(/ /g, '_')}`).digest('hex')}.json`);
check('opened article is cached and kept', fs.existsSync(file));
check('cache still within the cap (plus the article in use)', size() <= LIMIT + fs.statSync(file).size, `${Math.round(size() / 1024)} KB`);

await app.close();
finish();
