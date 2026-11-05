// Test runner: `npm test` (online) · `npm run test:offline` (online, then again with no network — Linux only).
// On Linux the app runs on a virtual display (xvfb-run) when available, so no windows pop up.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const offline = process.argv.includes('--offline');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wikitree-test-'));
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const linux = process.platform === 'linux';
const xvfb = linux && has('xvfb-run') && !process.env.WIKITREE_TEST_HEADED;
const env = { ...process.env, WIKITREE_TEST_HOME: home, NODE_ENV: 'test' };

function run(file, { netns = false } = {}) {
  console.log(`\n▶ ${file}${netns ? ' (no network)' : ''}`);
  let cmd = [process.execPath, path.join(here, file)];
  if (xvfb) cmd = ['xvfb-run', '-a', '-s', '-screen 0 1400x900x24', ...cmd];
  const runEnv = { ...env };
  if (netns) {
    // Fresh network namespace: only loopback (used by the test driver), no internet.
    delete runEnv.WAYLAND_DISPLAY;
    delete runEnv.DBUS_SESSION_BUS_ADDRESS;
    const quoted = cmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    cmd = ['unshare', '-rn', 'sh', '-c', `ip link set lo up && exec ${quoted}`];
  }
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: runEnv });
  return r.status === 0;
}

let ok = run('file-bytes.test.mjs') && run('example.test.mjs') && run('tree-visibility.test.mjs') && run('tree-layout.test.mjs') && run('tree-interactions.test.mjs') && run('tree-search.test.mjs') && run('image-resize.test.mjs') && run('live-previews.test.mjs') && run('file-inspector.test.mjs') && run('file-formats.test.mjs') && run('files.test.mjs') && run('history.test.mjs') && run('app.test.mjs');
if (ok && offline) {
  if (!linux || !has('unshare') || !has('ip')) {
    console.log('\nOffline test needs Linux with unshare and ip; skipped.');
  } else {
    ok = run('offline.test.mjs', { netns: true });
  }
}
fs.rmSync(home, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
