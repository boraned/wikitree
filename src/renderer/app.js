// Router: #/ home · #/p/<id> tree · #/p/<id>/w/<nodeId> reader.
import { renderHome } from './views/home.js';
import { renderTree } from './views/tree.js';
import { renderReader } from './views/reader.js';
import { showError } from './lib/api.js';

const app = document.getElementById('app');
let cleanup = null;
let token = 0;

export function navigate(hash, { replace = false } = {}) {
  const depth = (history.state?.depth || 0) + (replace ? 0 : 1);
  if (replace) history.replaceState({ depth }, '', hash);
  else history.pushState({ depth }, '', hash);
  route();
}

/** Back within the app; falls back to `fallback` when there is no in-app history. */
export function goBack(fallback) {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

async function route() {
  const my = ++token;
  const [, kind, id, sub, nodeId] = location.hash.replace(/^#/, '').split('/');
  cleanup?.();
  cleanup = null;
  app.replaceChildren();
  try {
    let view;
    if (kind === 'p' && id && sub === 'w' && nodeId) view = await renderReader(app, id, nodeId);
    else if (kind === 'p' && id) view = await renderTree(app, id);
    else view = await renderHome(app);
    if (my !== token) view?.();
    else cleanup = view || null;
  } catch (e) {
    if (my !== token) return;
    showError(e.message);
    if (kind) navigate('#/', { replace: true });
  }
}

window.addEventListener('popstate', route);
// Images that fail (e.g. offline) disappear instead of showing a broken icon.
document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.classList.add('broken'); }, true);
if (!history.state) history.replaceState({ depth: 0 }, '', location.hash || '#/');
route();
