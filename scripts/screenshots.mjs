// Regenerates docs/screenshots/*.png from a fresh demo project (needs internet).
// Usage: npm run screenshots   (on Linux it uses xvfb-run automatically when available)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

// Re-run under a virtual display on Linux so no window appears on the desktop.
if (process.platform === 'linux' && !process.env.WIKITREE_SHOTS_CHILD && spawnSync('sh', ['-c', 'command -v xvfb-run']).status === 0) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, fileURLToPath(import.meta.url)], {
    stdio: 'inherit', env: { ...process.env, WIKITREE_SHOTS_CHILD: '1' },
  });
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wikitree-shots-'));
fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ exampleOffered: true })); // screenshots build their own demo
fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, WIKITREE_HOME: home } });
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
const shot = async (name) => { await win.waitForTimeout(700); await win.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('saved', name); };

async function pick({ q, header }) {
  await win.waitForSelector('.modal .picker');
  if (header) {
    await win.click('.modal .tab >> text=Header');
    await win.fill('.modal .pop-input', header);
    await win.press('.modal .pop-input', 'Enter');
  } else {
    await win.selectOption('.modal .lang', 'en');
    await win.fill('.modal .pop-input', q);
    await win.waitForSelector('.modal .result');
    await win.click('.modal .result >> nth=0');
  }
  await win.waitForSelector('.modal-back', { state: 'detached' });
}
async function addUnder(title, what) {
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(200);
  await win.$eval(`.node:has(.title:text-is("${title}")) .add`, (b) => b.click());
  await pick(what);
}

await win.waitForSelector('.wordmark');
await win.click('.new-card');
await win.selectOption('.modal .lang', 'en');
await win.fill('.modal .pop-input', 'Solar System');
await win.waitForSelector('.modal .result');
await shot('picker');
await win.click('.modal .result >> nth=0');
await win.waitForSelector('.node.is-root');

await addUnder('Solar System', { header: 'Planets' });
await addUnder('Solar System', { q: 'Sun' });
await addUnder('Solar System', { header: 'Exploration' });
await addUnder('Planets', { q: 'Earth' });
await addUnder('Planets', { q: 'Mars' });
await addUnder('Planets', { q: 'Jupiter' });
await addUnder('Earth', { q: 'Moon' });
await addUnder('Jupiter', { q: 'Europa (moon)' });
await addUnder('Exploration', { q: 'Voyager 1' });
await win.click('.icon-btn[title="Arrange"]');
await win.waitForTimeout(900);
await win.click('.icon-btn[title="Fit"]');
await shot('tree');

await win.click('.node.wiki:has(.title:text-is("Earth")) .title');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 30000 });
await shot('reader');

await win.click('.icon-btn[title="Tree"]');
await win.waitForSelector('.node.is-root');
await win.click('.icon-btn[title="Projects"]');
await win.waitForSelector('.card:not(.new-card)');
await shot('home');

await app.close();
fs.rmSync(home, { recursive: true, force: true });
