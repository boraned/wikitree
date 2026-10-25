// Offline end-to-end test. Run by `npm run test:offline` inside a network namespace with no internet,
// after app.test.mjs has saved "Orman" for offline reading.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, launch, check, finish, fit } from './helpers.mjs';

const { app, win } = await launch({ offline: true });
check('the app sees no network', !(await win.evaluate(() => navigator.onLine)));
await win.waitForSelector('.card:not(.new-card)');
await win.click('.card:not(.new-card)');
await win.waitForSelector('.node.is-root');
await fit(win);

await win.click('.node.wiki:has-text("Orman") .title');
await win.waitForSelector('.wiki-body section', { state: 'attached', timeout: 15000 });
await win.waitForTimeout(1200);
const imgs = await win.$$eval('.wiki-body img', (e) => e.map((i) => i.src.startsWith('wikitree://media/') && i.complete && i.naturalWidth > 0));
check('saved article opens', (await win.textContent('.page-title')) === 'Orman');
check('its images load from disk', imgs.length > 0 && imgs.every(Boolean), `${imgs.filter(Boolean).length}/${imgs.length}`);

await win.click('.back');
await win.waitForSelector('.node.is-root');
await win.click('.node.wiki:has-text("Kök") .title');
await win.waitForSelector('.load-error', { timeout: 30000 });
check('unsaved article says "No internet connection"', (await win.textContent('.load-error')).includes('No internet connection'));
await win.click('.back');
await win.waitForSelector('.node.is-root');

await fit(win);
await win.click('.node.is-root .add');
await win.fill('.modal .pop-input', 'Forest');
await win.waitForSelector('.modal .status:not([hidden])', { timeout: 30000 });
check('search says "No internet connection"', (await win.textContent('.modal .status')) === 'No internet connection');
await win.keyboard.press('Escape');

await win.click('.icon-btn[title="Projects"]');
await win.waitForSelector('.card:not(.new-card)');
await win.hover('.card:not(.new-card)');
await win.click('.card-del');
await win.waitForSelector('.modal .btn-danger');
await win.click('.modal .btn-danger');
await win.waitForTimeout(400);
check('deleting a project removes its folder', fs.readdirSync(path.join(HOME, 'projects')).length === 0);
await app.close();
finish();
