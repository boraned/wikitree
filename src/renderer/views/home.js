// Main menu: logo, big green "+" card, project cards.
import { api, showError } from '../lib/api.js';
import { navigate } from '../app.js';
import { h, timeAgo, icon } from '../lib/dom.js';
import { pickNode, confirmDialog } from '../lib/modal.js';
import { themeButton } from '../lib/theme.js';

export async function renderHome(root) {
  const grid = h('div', { class: 'grid' });
  const view = h('div', { class: 'home' },
    themeButton('home-theme'),
    h('header', { class: 'brand' },
      h('img', { class: 'globe', src: 'assets/img/wikipedia-globe.svg', alt: '' }),
      h('h1', { class: 'wordmark' }, 'WikiTree'),
    ),
    grid,
  );
  root.append(view);

  const add = h('button', { class: 'card new-card', title: 'New project', 'aria-label': 'New project' });
  add.innerHTML = icon.plus;
  add.onclick = async () => {
    const choice = await pickNode();
    if (!choice) return;
    try {
      const p = await api.createProject(choice);
      navigate(`#/p/${p.id}`);
    } catch (err) { showError(err.message); }
  };
  grid.append(add);

  const projects = await api.projects();
  for (const p of projects) {
    const thumbs = h('div', { class: `collage n${Math.min(p.thumbs.length, 6)}` },
      ...p.thumbs.map((src) => h('img', { src, alt: '', loading: 'lazy' })));
    if (!p.thumbs.length) thumbs.append(h('img', { class: 'collage-empty', src: 'assets/img/wikipedia-globe.svg', alt: '' }));

    const del = h('button', { class: 'card-del', title: 'Delete' }, '×');
    const card = h('div', { class: 'card', role: 'button', tabindex: 0 },
      thumbs,
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, p.title),
        h('div', { class: 'card-meta' }, `${p.count} ${p.count === 1 ? 'node' : 'nodes'} · ${timeAgo(p.updated)}`),
      ),
      del,
    );
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-del')) return;
      navigate(`#/p/${p.id}`);
    });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(`#/p/${p.id}`); });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete "${p.title}"?`))) return;
      try {
        await api.deleteProject(p.id);
        card.remove();
      } catch (err) { showError(err.message); }
    });
    grid.append(card);
  }
}
