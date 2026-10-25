// Project tree: free-positioned nodes. Drag to move a branch, drop it on another node to re-attach it,
// and nodes that end up too close glide apart. Every change is saved.
import { api, showError, isOffline } from '../lib/api.js';
import { navigate } from '../app.js';
import { h, iconBtn, icon } from '../lib/dom.js';
import { pickNode, confirmDialog } from '../lib/modal.js';
import { saveOffline } from '../lib/clean.js';
import * as store from '../lib/store.js';

const GAP = 18;        // space always kept between two nodes
const DRAG_START = 5;  // px a press must travel before it becomes a drag
const EASE = 0.22;     // animation speed (fraction of remaining distance per frame)

export async function renderTree(root, projectId) {
  const project = await store.loadProject(projectId);
  const N = project.nodes;
  const viewKey = `wt-view-${projectId}`;
  const lastKey = `wt-last-${projectId}`;

  const homeBtn = iconBtn('home', 'Projects');
  const saveAllBtn = iconBtn('save', 'Save all offline', 'icon-btn save-btn');
  const arrangeBtn = iconBtn('arrange', 'Arrange');
  const fitBtn = iconBtn('fit', 'Fit');
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('edges');
  const nodesEl = h('div', { class: 'nodes' });
  const canvas = h('div', { class: 'canvas' }, edges, nodesEl);
  const viewport = h('div', { class: 'viewport' }, canvas);
  const view = h('div', { class: 'tree-view' },
    h('div', { class: 'topbar' }, homeBtn, h('div', { class: 'spacer' }), saveAllBtn, arrangeBtn, fitBtn),
    viewport);
  root.append(view);

  let t = JSON.parse(sessionStorage.getItem(viewKey) || 'null');
  const els = new Map();   // id → element
  const sigs = new Map();  // id → content signature (re-render only on change)
  const disp = new Map();  // id → displayed position (eases toward the stored one)
  let drag = null;
  let dropTarget = null;

  const apply = () => {
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    sessionStorage.setItem(viewKey, JSON.stringify(t));
  };
  const toCanvas = (cx, cy) => {
    const r = viewport.getBoundingClientRect();
    return { x: (cx - r.left - t.x) / t.k, y: (cy - r.top - t.y) / t.k };
  };

  // ---------- model helpers ----------
  function visible() {
    const out = [];
    const walk = (id) => { out.push(id); if (!N[id].collapsed) N[id].children.forEach(walk); };
    walk(project.rootId);
    return out;
  }
  const hiddenBelow = (id) => (N[id].collapsed ? store.subtree(id).slice(1).filter((x) => N[x].x != null) : []);
  const move = (id, dx, dy) => {
    if (!dx && !dy) return;
    N[id].x += dx;
    N[id].y += dy;
    store.shiftNodes(hiddenBelow(id), dx, dy);
  };

  // ---------- DOM ----------
  function fill(el, n, multiLang) {
    const entering = el.classList.contains('enter');
    el.className = `node ${n.type}${n.parent == null ? ' is-root' : ''}${entering ? ' enter' : ''}`;
    el.replaceChildren();
    if (n.type === 'wiki') {
      const src = n.thumbLocal || n.thumb;
      el.append(
        src ? h('img', { class: 'thumb', src, alt: '', draggable: 'false' }) : h('div', { class: 'thumb ph' }, 'W'),
        h('div', { class: 'txt' },
          h('div', { class: 'title' }, n.title),
          n.description ? h('div', { class: 'desc' }, n.description) : null),
      );
      if (multiLang) el.append(h('span', { class: 'lang-tag' }, n.lang.toUpperCase()));
    } else {
      el.append(h('div', { class: 'title' }, n.title));
    }
    if (n.parent != null) el.append(h('button', { class: 'del', title: 'Delete' }, '×'));
    if (n.children.length) {
      el.append(h('button', { class: `fold${n.collapsed ? ' closed' : ''}`, title: n.collapsed ? 'Expand' : 'Collapse' },
        n.collapsed ? `+${store.descendantCount(n.id)}` : '−'));
    }
    el.append(h('button', { class: 'add', title: 'Add' }, '+'));
  }

  function sync() {
    const vis = visible();
    const set = new Set(vis);
    const multiLang = new Set(store.wikiNodes().map((n) => n.lang)).size > 1; // language tags only in mixed trees
    for (const [id, el] of els) {
      if (!set.has(id)) { el.remove(); els.delete(id); sigs.delete(id); disp.delete(id); }
    }
    for (const id of vis) {
      const n = N[id];
      let el = els.get(id);
      if (!el) {
        el = h('div', { class: 'node enter', 'data-id': id });
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
        els.set(id, el);
        nodesEl.append(el);
      }
      const sig = JSON.stringify([n.type, n.title, n.description, n.thumbLocal || n.thumb, n.lang, multiLang, n.collapsed, n.children.length, n.parent == null]);
      if (sigs.get(id) !== sig) { fill(el, n, multiLang); sigs.set(id, sig); }
      el.classList.toggle('last', sessionStorage.getItem(lastKey) === id);
    }
    for (const id of vis) {
      const el = els.get(id);
      N[id].w = el.offsetWidth;
      N[id].h = el.offsetHeight;
    }
    return vis;
  }

  // ---------- layout ----------
  /** Classic top-down tree layout around the root's current position. */
  function tidy() {
    const W = (id) => N[id].w || store.EST.w;
    const widths = new Map();
    const measure = (id) => {
      const n = N[id];
      const kids = n.collapsed ? [] : n.children;
      let w = W(id);
      if (kids.length) w = Math.max(w, kids.reduce((s, c) => s + measure(c), 0) + store.GAP_X * (kids.length - 1));
      widths.set(id, w);
      return w;
    };
    measure(project.rootId);
    const rowH = [];
    const depth = new Map();
    const walk = (id, d) => {
      depth.set(id, d);
      rowH[d] = Math.max(rowH[d] || 0, N[id].h || store.EST.h);
      if (!N[id].collapsed) N[id].children.forEach((c) => walk(c, d + 1));
    };
    walk(project.rootId, 0);
    const rowY = [0];
    for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + store.GAP_Y;
    const r = N[project.rootId];
    const ox = r.x ?? 0;
    const oy = r.y ?? 0;
    const place = (id, left) => {
      const n = N[id];
      const nx = ox + left + widths.get(id) / 2;
      const ny = oy + rowY[depth.get(id)];
      if (n.x != null) store.shiftNodes(hiddenBelow(id), nx - n.x, ny - n.y);
      n.x = nx;
      n.y = ny;
      if (n.collapsed || !n.children.length) return;
      const sum = n.children.reduce((s, c) => s + widths.get(c), 0) + store.GAP_X * (n.children.length - 1);
      let x = left + (widths.get(id) - sum) / 2;
      for (const c of n.children) { place(c, x); x += widths.get(c) + store.GAP_X; }
    };
    place(project.rootId, -widths.get(project.rootId) / 2);
  }

  function ensurePositions(vis) {
    if (N[project.rootId].x == null) { tidy(); return true; }
    let placed = false;
    for (const id of vis) {
      if (N[id].x == null) { Object.assign(N[id], store.childSlot(N[N[id].parent])); placed = true; }
    }
    return placed;
  }

  /** Pushes overlapping nodes apart until every pair keeps GAP. Pinned nodes never move. */
  function resolve(pinned = new Set()) {
    const vis = visible();
    let any = false;
    for (let pass = 0; pass < 80; pass++) {
      let moved = false;
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const A = N[vis[i]];
          const B = N[vis[j]];
          const pa = pinned.has(A.id);
          const pb = pinned.has(B.id);
          if (pa && pb) continue;
          const ox = Math.min(A.x + A.w / 2 + GAP - (B.x - B.w / 2), B.x + B.w / 2 + GAP - (A.x - A.w / 2));
          const oy = Math.min(A.y + A.h + GAP - B.y, B.y + B.h + GAP - A.y);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const wa = pa ? 0 : pb ? 1 : 0.5;
          const wb = 1 - wa;
          if (ox <= oy) {
            const s = A.x <= B.x ? -1 : 1;
            move(A.id, s * (ox + 0.5) * wa, 0);
            move(B.id, -s * (ox + 0.5) * wb, 0);
          } else {
            const s = A.y <= B.y ? -1 : 1;
            move(A.id, 0, s * (oy + 0.5) * wa);
            move(B.id, 0, -s * (oy + 0.5) * wb);
          }
        }
      }
      if (!moved) break;
      any = true;
    }
    return any;
  }

  /** Re-render, place, de-overlap and animate. `changed` persists the result. */
  function refresh({ pinned, animate = true, changed = false } = {}) {
    const vis = sync();
    const placed = ensurePositions(vis);
    if (resolve(pinned) || changed || placed) store.changed();
    if (!animate) for (const id of vis) disp.set(id, { x: N[id].x, y: N[id].y });
    kick();
  }

  // ---------- animation ----------
  let raf = 0;
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  function frame() {
    raf = 0;
    let moving = false;
    for (const [id, el] of els) {
      const n = N[id];
      let d = disp.get(id);
      if (!d) {
        const p = disp.get(n.parent);
        d = p ? { x: p.x, y: p.y + (N[n.parent].h || 0) } : { x: n.x, y: n.y };
        disp.set(id, d);
      }
      if (drag?.ids.has(id)) {
        d.x = n.x;
        d.y = n.y;
      } else {
        const dx = n.x - d.x;
        const dy = n.y - d.y;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
          d.x += dx * EASE;
          d.y += dy * EASE;
          moving = true;
        } else {
          d.x = n.x;
          d.y = n.y;
        }
      }
      el.style.transform = `translate(${d.x - n.w / 2}px, ${d.y}px)`;
    }
    let s = '';
    for (const [id] of els) {
      const n = N[id];
      const a = disp.get(n.parent);
      const b = disp.get(id);
      if (!a || !b) continue;
      const y1 = a.y + N[n.parent].h;
      const my = (y1 + b.y) / 2;
      s += `<path d="M${a.x},${y1} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}"/>`;
    }
    edges.innerHTML = s;
    if (moving) kick();
  }

  // ---------- view ----------
  function bounds() {
    let l = Infinity; let r = -Infinity; let tp = Infinity; let b = -Infinity;
    for (const id of visible()) {
      const n = N[id];
      l = Math.min(l, n.x - n.w / 2); r = Math.max(r, n.x + n.w / 2);
      tp = Math.min(tp, n.y); b = Math.max(b, n.y + n.h);
    }
    return { l, r, t: tp, b };
  }
  function fit() {
    const r = viewport.getBoundingClientRect();
    const bb = bounds();
    const bw = bb.r - bb.l + 40;
    const bh = bb.b - bb.t + 40;
    const k = Math.min(1.1, Math.max(0.2, Math.min((r.width - 80) / bw, (r.height - 80) / bh)));
    t = { k, x: r.width / 2 - ((bb.l + bb.r) / 2) * k, y: r.height / 2 - ((bb.t + bb.b) / 2) * k };
    apply();
  }
  function reveal(id) {
    const n = N[id];
    if (!n || !els.has(id)) return;
    const r = viewport.getBoundingClientRect();
    const sx = n.x * t.k + t.x;
    const sy = n.y * t.k + t.y;
    if (sx < 60 || sx > r.width - 60 || sy < 40 || sy > r.height - 80) {
      t.x = r.width / 2 - n.x * t.k;
      t.y = r.height / 2 - (n.y + n.h / 2) * t.k;
      apply();
    }
  }

  refresh({ animate: false });
  if (t) apply(); else fit();
  const last = sessionStorage.getItem(lastKey);
  if (last && N[last]) reveal(last);

  homeBtn.onclick = () => navigate('#/');
  fitBtn.onclick = fit;
  arrangeBtn.onclick = () => { sync(); tidy(); refresh({ changed: true }); };

  // ---------- pointer: pan, drag, drop ----------
  let pan = null;
  let press = null;
  let suppressClick = false;
  // A dragged node carries its branch along; the first node moves on its own
  // (carrying the whole tree would just be panning).
  const moving = (id) => (N[id].parent == null ? [id] : store.subtree(id).filter((x) => N[x].x != null));

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    closeMenus();
    const el = e.target.closest('.node');
    if (el) {
      if (e.target.closest('button, input')) return;
      press = { id: el.dataset.id, sx: e.clientX, sy: e.clientY, started: false };
      return;
    }
    pan = { x: e.clientX - t.x, y: e.clientY - t.y };
    viewport.classList.add('panning');
  });

  const onMove = (e) => {
    if (pan) {
      t.x = e.clientX - pan.x;
      t.y = e.clientY - pan.y;
      apply();
      return;
    }
    if (!press) return;
    const dxs = e.clientX - press.sx;
    const dys = e.clientY - press.sy;
    if (!press.started) {
      if (Math.hypot(dxs, dys) < DRAG_START) return;
      press.started = true;
      const ids = moving(press.id);
      drag = { ids: new Set(ids), orig: new Map(ids.map((x) => [x, { x: N[x].x, y: N[x].y }])) };
      for (const x of ids) els.get(x)?.classList.add('dragging');
      viewport.classList.add('dragging-node');
    }
    for (const [x, o] of drag.orig) {
      N[x].x = o.x + dxs / t.k;
      N[x].y = o.y + dys / t.k;
    }
    // A node under the pointer (not in the dragged branch) becomes the new parent on drop.
    let target = null;
    if (N[press.id].parent != null) {
      const p = toCanvas(e.clientX, e.clientY);
      for (const [id] of els) {
        if (drag.ids.has(id)) continue;
        const n = N[id];
        if (p.x >= n.x - n.w / 2 - 6 && p.x <= n.x + n.w / 2 + 6 && p.y >= n.y - 6 && p.y <= n.y + n.h + 6) target = id;
      }
    }
    if (target !== dropTarget) {
      if (dropTarget) els.get(dropTarget)?.classList.remove('drop');
      dropTarget = target;
      if (dropTarget) els.get(dropTarget)?.classList.add('drop');
    }
    kick();
  };

  const onUp = () => {
    if (pan) { pan = null; viewport.classList.remove('panning'); }
    if (press?.started) {
      const id = press.id;
      for (const x of drag.ids) els.get(x)?.classList.remove('dragging');
      viewport.classList.remove('dragging-node');
      const target = dropTarget;
      if (target) els.get(target)?.classList.remove('drop');
      dropTarget = null;
      drag = null;
      if (target && target !== N[id].parent) store.reparent(id, target);
      refresh({ pinned: new Set(moving(id)), changed: true });
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
    press = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // Zoom around the cursor (shift+wheel pans sideways).
  viewport.addEventListener('wheel', (e) => {
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

  // ---------- node actions ----------
  nodesEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    const el = e.target.closest('.node');
    if (!el) return;
    const n = N[el.dataset.id];
    if (e.target.closest('.add')) return addChild(n.id);
    if (e.target.closest('.del')) return remove(n.id);
    if (e.target.closest('.fold')) { store.toggleCollapse(n.id); refresh({ changed: true }); return; }
    if (e.target.closest('input')) return;
    if (n.type === 'wiki') open(n.id);
  });
  nodesEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.node');
    if (!el || e.target.closest('button')) return;
    if (N[el.dataset.id].type === 'header') rename(el.dataset.id);
  });
  nodesEl.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.node');
    if (!el) return;
    e.preventDefault();
    contextMenu(N[el.dataset.id], e.clientX, e.clientY);
  });

  function open(id) {
    sessionStorage.setItem(lastKey, id);
    navigate(`#/p/${projectId}/w/${id}`);
  }

  async function addChild(parentId) {
    const c = await pickNode();
    if (!c || !view.isConnected) return;
    if (c.type === 'wiki') {
      const dup = store.findChildByTitle(parentId, c.title, c.lang);
      if (dup) { flash(dup.id); return; }
    }
    const n = store.addNode(parentId, c.type === 'wiki'
      ? { type: 'wiki', title: c.title, lang: c.lang, description: c.description, thumb: c.thumb }
      : { type: 'header', title: c.title });
    refresh({ changed: true });
    reveal(n.id);
    flash(n.id);
  }

  async function remove(id) {
    const n = N[id];
    const count = store.descendantCount(id);
    if (count && !(await confirmDialog(`Delete "${n.title}" and ${count} below it?`))) return;
    const removed = store.removeNode(id);
    refresh({ changed: true });
    await store.flush();
    // Drop offline copies nothing else in the project uses.
    for (const r of removed) {
      if (r.type === 'wiki' && !store.hasWiki(r.title, r.lang)) api.unsavePage({ projectId, lang: r.lang, title: r.title }).catch(() => {});
    }
  }

  function rename(id) {
    const n = N[id];
    const el = els.get(id);
    const titleDiv = el.querySelector('.title');
    const input = h('textarea', { class: 'rename', rows: 1, maxlength: 300 });
    input.value = n.title;
    titleDiv.replaceWith(input);
    const grow = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
    grow();
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.replace(/\s+/g, ' ').trim();
      sigs.delete(id);
      if (save && v && v !== n.title) store.renameNode(id, v);
      refresh({ changed: save });
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  }

  function flash(id) {
    const el = els.get(id);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---------- context menu ----------
  let menu = null;
  function closeMenus() { menu?.remove(); menu = null; }
  const onDocDown = (e) => { if (menu && !menu.contains(e.target)) closeMenus(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenus(); };
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);

  function contextMenu(n, x, y) {
    closeMenus();
    const items = [
      n.type === 'wiki' && ['Open', () => open(n.id)],
      n.type === 'header' && ['Rename', () => rename(n.id)],
      ['Add below', () => addChild(n.id)],
      n.children.length && [n.collapsed ? 'Expand' : 'Collapse', () => { store.toggleCollapse(n.id); refresh({ changed: true }); }],
      n.parent != null && ['Delete', () => remove(n.id), 'danger'],
    ].filter(Boolean);
    menu = h('div', { class: 'ctx' }, ...items.map(([label, fn, cls]) =>
      h('button', { class: cls || '', onclick: () => { closeMenus(); fn(); } }, label)));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  }

  // ---------- save all for offline ----------
  const uniqueWikis = () => {
    const seen = new Map();
    for (const n of store.wikiNodes()) seen.set(`${n.lang}:${n.title.toLowerCase()}`, n);
    return [...seen.values()];
  };
  async function paintSaveAll() {
    const wikis = uniqueWikis();
    const state = wikis.length ? await api.savedState(projectId, wikis.map((n) => ({ lang: n.lang, title: n.title }))) : [];
    const all = wikis.length > 0 && state.every(Boolean);
    saveAllBtn.innerHTML = all ? icon.saved : icon.save;
    saveAllBtn.classList.toggle('on', all);
    saveAllBtn.title = all ? 'Saved offline' : 'Save all offline';
    return { wikis, state };
  }
  paintSaveAll().catch(() => {});
  saveAllBtn.onclick = async () => {
    if (saveAllBtn.classList.contains('busy')) return;
    const { wikis, state } = await paintSaveAll();
    const todo = wikis.filter((_, i) => !state[i]);
    if (!todo.length) return;
    saveAllBtn.classList.add('busy');
    const progress = h('span', { class: 'progress-text' });
    saveAllBtn.append(progress);
    let done = 0;
    for (const n of todo) {
      progress.textContent = `${done}/${todo.length}`;
      try {
        const r = await saveOffline(api, projectId, n);
        for (const m of store.wikiNodes()) {
          if (m.lang !== n.lang || m.title.toLowerCase() !== n.title.toLowerCase()) continue;
          if (r.title !== m.title) m.title = r.title;
          if (r.thumbLocal) m.thumbLocal = r.thumbLocal;
        }
        store.changed();
      } catch (e) {
        if (isOffline(e)) { showError('No internet connection'); break; }
      }
      done++;
    }
    saveAllBtn.classList.remove('busy');
    if (view.isConnected) { refresh(); await paintSaveAll().catch(() => {}); }
  };

  return () => {
    cancelAnimationFrame(raf);
    closeMenus();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey);
    store.flush();
  };
}
