// Main menu: logo, new project, project list.
import { api, showError } from './api.js';
import { navigate } from './app.js';
import { h, timeAgo } from './dom.js';

export async function renderHome(root) {
  const input = h('input', { class: 'new-input', placeholder: 'New project', maxlength: 120, autocomplete: 'off' });
  const create = h('button', { class: 'btn-green', type: 'submit' }, 'Create');
  const form = h('form', { class: 'new-form' }, input, create);
  const grid = h('div', { class: 'grid' });

  const view = h('div', { class: 'home' },
    h('header', { class: 'brand' },
      h('img', { class: 'globe', src: 'img/wikipedia-globe.svg', alt: '' }),
      h('h1', { class: 'wordmark' }, 'WikiTree'),
    ),
    form,
    grid,
  );
  root.append(view);
  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return input.focus();
    create.disabled = true;
    try {
      const p = await api.createProject(title);
      navigate(`#/p/${p.id}`);
    } catch (err) {
      showError(err.message);
      create.disabled = false;
    }
  });

  const projects = await api.projects();
  for (const p of projects) {
    const thumbs = h('div', { class: `collage n${Math.min(p.thumbs.length, 4)}` },
      ...p.thumbs.map((src) => h('img', { src, alt: '', loading: 'lazy' })));
    if (!p.thumbs.length) thumbs.append(h('img', { class: 'collage-empty', src: 'img/wikipedia-globe.svg', alt: '' }));

    const del = h('button', { class: 'card-del', title: 'Delete' }, '×');
    const card = h('a', { class: 'card', href: `#/p/${p.id}` },
      thumbs,
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, p.title),
        h('div', { class: 'card-meta' }, `${p.count} ${p.count === 1 ? 'node' : 'nodes'} · ${timeAgo(p.updated)}`),
      ),
      del,
    );
    card.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.target === del) return;
      navigate(`#/p/${p.id}`);
    });
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!confirm(`Delete "${p.title}"?`)) return;
      try {
        await api.deleteProject(p.id);
        card.remove();
      } catch (err) { showError(err.message); }
    });
    grid.append(card);
  }
}
