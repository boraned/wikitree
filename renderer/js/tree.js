// Project tree: layout, pan/zoom, add/rename/delete/collapse nodes.
import { api, cachedSummary, showError } from './api.js';
import { navigate } from './app.js';
import { h, iconBtn } from './dom.js';
import * as store from './store.js';

const W = 232;
const ROW = 150;
const GAP = 26;
const HEIGHT = { root: 66, header: 48, wiki: 66 };

export async function renderTree(root, projectId) {
  const project = await store.loadProject(projectId);
  const viewKey = `wt-view-${projectId}`;
  const lastKey = `wt-last-${projectId}`;

  const homeBtn = iconBtn('home', 'Projects');
  const fitBtn = iconBtn('fit', 'Fit');
  const titleEl = h('div', { class: 'bar-title' }, project.title);
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('edges');
  const nodesEl = h('div', { class: 'nodes' });
  const canvas = h('div', { class: 'canvas' }, edges, nodesEl);
  const viewport = h('div', { class: 'viewport' }, canvas);
  const view = h('div', { class: 'tree-view' },
    h('div', { class: 'topbar' }, homeBtn, titleEl, h('div', { class: 'spacer' }), fitBtn),
    viewport);
  root.append(view);

  let t = JSON.parse(sessionStorage.getItem(viewKey) || 'null');
  let bounds = { w: W, h: HEIGHT.root };
  const pos = new Map();
  const seen = new Set();

  const apply = () => {
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    sessionStorage.setItem(viewKey, JSON.stringify(t));
  };

  // ---------- layout ----------
  function measure(id) {
    const n = project.nodes[id];
    if (n.collapsed || !n.children.length) return (n._w = W);
    const sum = n.children.reduce((s, c) => s + measure(c), 0) + GAP * (n.children.length - 1);
    return (n._w = Math.max(W, sum));
  }
  function place(id, left, depth) {
    const n = project.nodes[id];
    pos.set(id, { x: left + n._w / 2, y: depth * ROW, h: HEIGHT[n.type] });
    if (n.collapsed) return depth;
    let x = left + (n._w - (n.children.reduce((s, c) => s + project.nodes[c]._w, 0) + GAP * (n.children.length - 1))) / 2;
    let maxDepth = depth;
    for (const c of n.children) {
      maxDepth = Math.max(maxDepth, place(c, x, depth + 1));
      x += project.nodes[c]._w + GAP;
    }
    return maxDepth;
  }

  // ---------- render ----------
  function render() {
    pos.clear();
    const total = measure(project.rootId);
    const depth = place(project.rootId, 0, 0);
    for (const n of Object.values(project.nodes)) delete n._w;
    bounds = { w: total, h: depth * ROW + HEIGHT.root + 40 };
    edges.setAttribute('width', bounds.w);
    edges.setAttribute('height', bounds.h);

    let paths = '';
    nodesEl.replaceChildren();
    for (const [id, p] of pos) {
      const n = project.nodes[id];
      if (n.parent && pos.has(n.parent)) {
        const a = pos.get(n.parent);
        const y1 = a.y + a.h;
        const my = (y1 + p.y) / 2;
        paths += `<path d="M${a.x},${y1} C${a.x},${my} ${p.x},${my} ${p.x},${p.y}"/>`;
      }
      nodesEl.append(nodeEl(n, p));
    }
    edges.innerHTML = paths;
    titleEl.textContent = project.title;
  }

  function nodeEl(n, p) {
    const el = h('div', {
      class: `node ${n.type}${seen.has(n.id) ? '' : ' enter'}`, 'data-id': n.id,
      style: `left:${p.x - W / 2}px; top:${p.y}px; width:${W}px; height:${p.h}px`,
    });
    seen.add(n.id);
    if (n.type === 'wiki') {
      el.append(
        n.thumb ? h('img', { class: 'thumb', src: n.thumb, alt: '', draggable: 'false' }) : h('div', { class: 'thumb ph' }, 'W'),
        h('div', { class: 'txt' }, h('div', { class: 'title' }, n.title), n.description ? h('div', { class: 'desc' }, n.description) : null),
      );
    } else {
      el.append(h('div', { class: 'title' }, n.title));
    }
    if (n.type !== 'root') el.append(h('button', { class: 'del', title: 'Delete' }, '×'));
    if (n.children.length) {
      el.append(h('button', { class: `fold${n.collapsed ? ' closed' : ''}`, title: n.collapsed ? 'Expand' : 'Collapse' },
        n.collapsed ? `+${store.descendantCount(n.id)}` : '−'));
    }
    el.append(h('button', { class: 'add', title: 'Add' }, '+'));
    if (sessionStorage.getItem(lastKey) === n.id) el.classList.add('last');
    return el;
  }

  // ---------- view ----------
  function fit() {
    const r = viewport.getBoundingClientRect();
    const k = Math.min(1.1, Math.max(0.2, Math.min((r.width - 80) / bounds.w, (r.height - 80) / bounds.h)));
    t = { k, x: (r.width - bounds.w * k) / 2, y: Math.max(40, (r.height - bounds.h * k) / 2) };
    apply();
  }
  function reveal(id) {
    const p = pos.get(id);
    if (!p) return;
    const r = viewport.getBoundingClientRect();
    const sx = p.x * t.k + t.x;
    const sy = p.y * t.k + t.y;
    if (sx < 60 || sx > r.width - 60 || sy < 40 || sy > r.height - 80) {
      t.x = r.width / 2 - p.x * t.k;
      t.y = r.height / 2 - (p.y + p.h / 2) * t.k;
      apply();
    }
  }

  render();
  if (t) apply(); else fit();
  const last = sessionStorage.getItem(lastKey);
  if (last && project.nodes[last]) reveal(last);

  fitBtn.onclick = fit;
  homeBtn.onclick = () => navigate('#/');

  // pan
  let drag = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.node, .popover, .ctx')) return;
    closeMenus();
    drag = { x: e.clientX - t.x, y: e.clientY - t.y };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('panning');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    t.x = e.clientX - drag.x;
    t.y = e.clientY - drag.y;
    apply();
  });
  const endDrag = () => { drag = null; viewport.classList.remove('panning'); };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // zoom around cursor (shift+wheel pans horizontally)
  viewport.addEventListener('wheel', (e) => {
    if (e.target.closest('.popover')) return;
    e.preventDefault();
    if (e.shiftKey) { t.x -= e.deltaY + e.deltaX; apply(); return; }
    const r = viewport.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(2.2, Math.max(0.15, t.k * Math.exp(-e.deltaY * 0.0015)));
    t.x = mx - ((mx - t.x) * k) / t.k;
    t.y = my - ((my - t.y) * k) / t.k;
    t.k = k;
    apply();
  }, { passive: false });

  // ---------- node interactions ----------
  nodesEl.addEventListener('click', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    const n = project.nodes[el.dataset.id];
    if (e.target.closest('.add')) return openAdd(n.id, e.target);
    if (e.target.closest('.del')) return remove(n.id);
    if (e.target.closest('.fold')) { store.toggleCollapse(n.id); render(); return; }
    if (n.type === 'wiki') open(n.id);
  });
  nodesEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.node');
    if (!el || e.target.closest('button')) return;
    const n = project.nodes[el.dataset.id];
    if (n.type !== 'wiki') rename(n.id, el);
  });
  nodesEl.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    e.preventDefault();
    contextMenu(project.nodes[el.dataset.id], e.clientX, e.clientY, el);
  });

  function open(id) {
    sessionStorage.setItem(lastKey, id);
    navigate(`#/p/${projectId}/w/${id}`);
  }

  function remove(id) {
    const n = project.nodes[id];
    const count = store.descendantCount(id);
    if (count && !confirm(`Delete "${n.title}" and ${count} below it?`)) return;
    store.removeNode(id);
    render();
  }

  function rename(id, el) {
    const n = project.nodes[id];
    const titleDiv = el.querySelector('.title');
    const input = h('input', { class: 'rename', value: n.title, maxlength: 120 });
    titleDiv.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== n.title) store.renameNode(id, v);
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ---------- menus ----------
  let menu = null;
  function closeMenus() {
    menu?.remove();
    menu = null;
  }
  const onDocDown = (e) => { if (menu && !menu.contains(e.target)) closeMenus(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenus(); };
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);

  function placeMenu(el, x, y) {
    document.body.append(el);
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  }

  function contextMenu(n, x, y, el) {
    closeMenus();
    const sib = n.parent ? project.nodes[n.parent].children : [];
    const i = sib.indexOf(n.id);
    const items = [
      n.type === 'wiki' && ['Open', () => open(n.id)],
      n.type !== 'wiki' && ['Rename', () => rename(n.id, el)],
      ['Add below', () => openAdd(n.id, el.querySelector('.add'))],
      n.children.length && [n.collapsed ? 'Expand' : 'Collapse', () => { store.toggleCollapse(n.id); render(); }],
      i > 0 && ['Move left', () => { store.moveNode(n.id, -1); render(); }],
      i >= 0 && i < sib.length - 1 && ['Move right', () => { store.moveNode(n.id, 1); render(); }],
      n.type !== 'root' && ['Delete', () => remove(n.id), 'danger'],
    ].filter(Boolean);
    menu = h('div', { class: 'ctx' }, ...items.map(([label, fn, cls]) =>
      h('button', { class: cls || '', onclick: () => { closeMenus(); fn(); } }, label)));
    placeMenu(menu, x, y);
  }

  function openAdd(parentId, anchor) {
    closeMenus();
    let mode = 'wiki';
    let results = [];
    let sel = 0;
    let timer = null;
    let seq = 0;

    const tabWiki = h('button', { class: 'tab on' }, 'Wiki');
    const tabHeader = h('button', { class: 'tab' }, 'Header');
    const input = h('input', { class: 'pop-input', placeholder: 'Search Wikipedia', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div', { class: 'results' });
    menu = h('div', { class: 'popover' }, h('div', { class: 'tabs' }, tabWiki, tabHeader), input, list);
    const r = anchor.getBoundingClientRect();
    placeMenu(menu, r.left + r.width / 2 - 170, r.bottom + 10);
    input.focus();

    const setMode = (m) => {
      mode = m;
      tabWiki.classList.toggle('on', m === 'wiki');
      tabHeader.classList.toggle('on', m === 'header');
      input.placeholder = m === 'wiki' ? 'Search Wikipedia' : 'Header name';
      list.replaceChildren();
      results = [];
      if (m === 'wiki') search();
      input.focus();
    };
    tabWiki.onclick = () => setMode('wiki');
    tabHeader.onclick = () => setMode('header');

    const paint = () => {
      list.replaceChildren(...results.map((res, idx) => h('button', { class: `result${idx === sel ? ' sel' : ''}`, onclick: () => pickWiki(res) },
        res.thumb ? h('img', { src: res.thumb, alt: '' }) : h('div', { class: 'ph' }, 'W'),
        h('div', { class: 'txt' }, h('div', { class: 'title' }, res.title), res.description ? h('div', { class: 'desc' }, res.description) : null))));
    };

    async function search() {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { results = []; paint(); return; }
      try {
        const res = await api.search(q);
        if (my !== seq) return;
        results = res;
        sel = 0;
        paint();
      } catch (e) { showError(e.message); }
    }

    async function pickWiki(res) {
      if (menu?.dataset.busy) return;
      menu.dataset.busy = '1';
      menu.classList.add('busy');
      try {
        const s = await cachedSummary(res.title);
        const nn = store.findChildByTitle(parentId, s.title)
          || store.addNode(parentId, { type: 'wiki', title: s.title, description: s.description, thumb: s.thumb });
        closeMenus();
        render();
        flash(nn.id);
      } catch (e) {
        showError(e.message);
        if (menu) { delete menu.dataset.busy; menu.classList.remove('busy'); }
      }
    }

    input.addEventListener('input', () => {
      if (mode !== 'wiki') return;
      clearTimeout(timer);
      timer = setTimeout(search, 180);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); setMode(mode === 'wiki' ? 'header' : 'wiki'); return; }
      if (mode === 'wiki' && results.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        paint();
        list.children[sel]?.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        if (mode === 'header') {
          const nn = store.addNode(parentId, { type: 'header', title: v.slice(0, 120) });
          closeMenus();
          render();
          flash(nn.id);
        } else if (results[sel]) pickWiki(results[sel]);
      }
    });
  }

  function flash(id) {
    const el = id && nodesEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  const onResize = () => apply();
  window.addEventListener('resize', onResize);

  return () => {
    closeMenus();
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    store.flush();
  };
}
