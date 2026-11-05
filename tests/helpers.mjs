// Shared helpers for the end-to-end tests (real Electron app driven by playwright-core).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.WIKITREE_TEST_HOME;
if (!HOME) throw new Error('Run the tests through `npm test` (tests/run.mjs).');

const fails = [];
export const log = (...a) => console.log('  ', ...a);
export function check(name, ok, extra = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra && !ok ? `  ${extra}` : ''}`);
  if (!ok) fails.push(name);
}
export function finish() {
  if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
  console.log('\nall passed');
}

/** Tests start from an empty data folder unless they ask for the first-launch example project. */
function skipExample(home) {
  const file = path.join(home, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new home */ }
  if (settings.exampleOffered) return;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...settings, exampleOffered: true }));
}

export async function launch({ offline = false, example = false, home = HOME } = {}) {
  if (!example) skipExample(home);
  const executablePath = process.env.WIKITREE_TEST_EXECUTABLE || require('electron');
  const args = process.env.WIKITREE_TEST_EXECUTABLE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'];
  const env = { ...process.env, WIKITREE_HOME: home };
  // Electron otherwise prefers the real Wayland session even when xvfb-run provides DISPLAY.
  if (offline || (process.platform === 'linux' && !process.env.WIKITREE_TEST_HEADED)) {
    args.push('--ozone-platform=x11');
    delete env.WAYLAND_DISPLAY;
    delete env.GDK_SCALE; // a HiDPI desktop's scale would clamp the window to its minimum on the virtual screen
  }
  if (offline) {
    args.push('--disable-gpu');
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }
  const app = await electron.launch({ executablePath, args, env });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { app, win };
}

export function project() {
  const dir = fs.readdirSync(path.join(HOME, 'projects'))[0];
  return JSON.parse(fs.readFileSync(path.join(HOME, 'projects', dir, 'project.json'), 'utf8'));
}
export const nodes = () => Object.values(project().nodes);

export const settle = (win, ms = 900) => win.waitForTimeout(ms);

export async function fit(win) {
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(150);
}

/** Pairs of node boxes that overlap on screen. */
export function overlaps(win) {
  return win.$$eval('.node', (els) => {
    const r = els.map((e) => e.getBoundingClientRect());
    const bad = [];
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i];
        const b = r[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad.push([i, j]);
      }
    }
    return bad;
  });
}

/** Completes the centered picker: a Wikipedia search result or a header. */
export async function pick(win, { lang, q, header }) {
  await win.waitForSelector('.modal .picker');
  if (header) {
    await win.click('.modal .tab-header');
    await win.fill('.modal .pop-input', header);
    await win.press('.modal .pop-input', 'Enter');
  } else {
    if (lang) await win.selectOption('.modal .lang', lang);
    await win.fill('.modal .pop-input', q);
    await win.waitForSelector('.modal .result');
    await win.click('.modal .result >> nth=0');
  }
  await win.waitForSelector('.modal-back', { state: 'detached' });
}

export async function addToRoot(win, what) {
  await fit(win);
  await win.click('.node.is-root .add');
  await pick(win, what);
}

/** Drags from one point to another with real pointer events. */
export async function drag(win, from, to) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await win.mouse.move(to.x, to.y, { steps: 12 });
}
