#!/usr/bin/env node
// Builds a static, installable PWA from the shared renderer. Output is ready for any HTTPS static host.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web-dist');
const renderer = path.join(root, 'src', 'renderer');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await fs.cp(renderer, out, { recursive: true });
await fs.copyFile(path.join(root, 'webapp', 'adapter.js'), path.join(out, 'browser-api.js'));
await fs.copyFile(path.join(root, 'webapp', 'manifest.json'), path.join(out, 'manifest.json'));
await fs.copyFile(path.join(root, 'webapp', 'ios.css'), path.join(out, 'ios.css'));
await fs.copyFile(path.join(root, 'webapp', 'service-worker.template.js'), path.join(out, 'service-worker.template.js'));
await fs.copyFile(path.join(root, 'build', 'icon.png'), path.join(out, 'icon-512.png'));
await fs.copyFile(path.join(root, 'build', 'icon.png'), path.join(out, 'icon-192.png'));
await fs.copyFile(path.join(root, 'build', 'icon.png'), path.join(out, 'apple-touch-icon.png'));

let html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  <meta name="theme-color" content="#1c1c1e">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n  <meta name="apple-mobile-web-app-title" content="WikiTree">\n  <link rel="manifest" href="./manifest.json">\n  <link rel="apple-touch-icon" href="./apple-touch-icon.png">');
html = html.replace('</head>', '  <link rel="stylesheet" href="./ios.css">\n</head>');
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module" src="./web-entry.js"></script>');
await fs.writeFile(path.join(out, 'index.html'), html);

await fs.writeFile(path.join(out, 'web-entry.js'), `import { installBrowserApi } from './browser-api.js';\nawait installBrowserApi();\nif ('serviceWorker' in navigator) {\n  try {\n    await navigator.serviceWorker.register('./service-worker.js', { scope: './' });\n    await navigator.serviceWorker.ready;\n    if (!navigator.serviceWorker.controller) await Promise.race([new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })), new Promise((resolve) => setTimeout(resolve, 2500))]);\n  } catch (error) { console.warn('Offline shell not installed:', error); }\n}\nawait import('./app.js');\n`);

async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else if (entry.name !== 'service-worker.template.js') out.push(`./${rel}`);
  }
  return out;
}
const precache = [...new Set(['./', ...await walk(out)])];
let sw = await fs.readFile(path.join(out, 'service-worker.template.js'), 'utf8');
sw = sw.replace('__PRECACHE__', JSON.stringify(precache));
await fs.writeFile(path.join(out, 'service-worker.js'), sw);
await fs.rm(path.join(out, 'service-worker.template.js'));
console.log(`Built web-dist/ (${precache.length} offline app-shell files).`);
