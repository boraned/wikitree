// Project tree: free-positioned nodes. Drag to move a branch, drop it on another node to re-attach it,
// and nodes that end up too close glide apart. Every change is saved.
import { api, showError, isOffline, fileUrl, isOpenable } from '../lib/api.js';
import { navigate } from '../app.js';
import { h, iconBtn, icon } from '../lib/dom.js';
import { pickNode, confirmDialog, searchNodes } from '../lib/modal.js';
import { saveOffline } from '../lib/clean.js';
import { openHistory } from '../lib/history.js';
import { expandGenerations, setAllCollapsed, expandAncestors } from '../lib/tree-visibility.js';
import { findNodes } from '../lib/node-search.js';
import { mountPreview, hostOf, fullscreenTarget, toggleFullscreen } from '../lib/previews.js';
import * as store from '../lib/store.js';

const GAP = 18;        // space always kept between two nodes
const DRAG_START = 5;  // px a press must travel before it becomes a drag
const MIN_NODE_SCALE = 0.25, MAX_NODE_SCALE = 8; // per-node size multiplier from the corner handle
const EASE = 0.22;     // animation speed (fraction of remaining distance per frame)

export async function renderTree(root, projectId) {
  const project = await store.loadProject(projectId);
  const N = project.nodes;
  const viewKey = `wt-view-${projectId}`;
  const lastKey = `wt-last-${projectId}`;
  const listeners = new AbortController(); // window listeners, removed when leaving the page

  const homeBtn = iconBtn('home', 'Projects');
  const webExport = typeof api.exportProject === 'function';
  const saveAllBtn = iconBtn('save', webExport ? 'Download .wt project' : 'Save all offline', 'icon-btn save-btn');
  const obsidianBtn = typeof api.exportObsidian === 'function' ? h('button', { class: 'btn-ghost obsidian-export', title: 'Export Obsidian Markdown' }, 'Obsidian') : null;
  const historyBtn = typeof api.history === 'function' ? iconBtn('history', 'History', 'icon-btn history-btn') : null;
  const arrangeBtn = iconBtn('arrange', 'Arrange');
  const fitBtn = iconBtn('fit', 'Fit');
  const expandAllBtn = h('button', { class: 'btn-ghost tree-action expand-all' }, 'Expand all');
  const shrinkAllBtn = h('button', { class: 'btn-ghost tree-action shrink-all' }, 'Shrink all');
  const sizeDownBtn = h('button', { class: 'btn-ghost tree-action node-size-down', title: 'Smaller nodes', 'aria-label': 'Smaller nodes' }, 'A−');
  const sizeUpBtn = h('button', { class: 'btn-ghost tree-action node-size-up', title: 'Larger nodes', 'aria-label': 'Larger nodes' }, 'A+');
  const searchBtn = iconBtn('search', 'Search nodes', 'icon-btn search-btn');
  const bottomActions = h('div', { class: 'tree-bottom-actions', id: 'tree-bottom-actions' },
    h('div', { class: 'node-size-controls' }, sizeDownBtn, sizeUpBtn), expandAllBtn, shrinkAllBtn, searchBtn, historyBtn);
  const controlsToggle = iconBtn('back', 'Show controls', 'btn-ghost tree-controls-toggle');
  controlsToggle.setAttribute('aria-controls', 'tree-bottom-actions');
  const bottomSection = h('div', { class: 'tree-controls' }, controlsToggle, bottomActions);
  function showControls(open) {
    bottomActions.hidden = !open;
    controlsToggle.setAttribute('aria-expanded', String(open));
    controlsToggle.title = open ? 'Hide controls' : 'Show controls';
    controlsToggle.setAttribute('aria-label', controlsToggle.title);
    sessionStorage.setItem('wt-tree-controls', open ? 'open' : 'closed');
  }
  showControls(sessionStorage.getItem('wt-tree-controls') === 'open');
  controlsToggle.onclick = () => showControls(bottomActions.hidden);
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('edges');
  const nodesEl = h('div', { class: 'nodes' });
  const canvas = h('div', { class: 'canvas' }, edges, nodesEl);
  const viewport = h('div', { class: 'viewport' }, canvas);
  const view = h('div', { class: 'tree-view' },
    h('div', { class: 'topbar' }, homeBtn, h('div', { class: 'spacer' }), saveAllBtn, obsidianBtn, arrangeBtn, fitBtn),
    viewport, bottomSection);
  root.append(view);

  let t = JSON.parse(sessionStorage.getItem(viewKey) || 'null');
  const els = new Map();   // id → element
  const sigs = new Map();  // id → content signature (re-render only on change)
  const csigs = new Map(); // id → controls signature (fold/add/delete buttons)
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
    for (const id of project.roots || [project.rootId]) if (N[id]) walk(id);
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
  const nodeScale = (n) => (project.nodeScale || 1) * (n.scale || 1);
  const previews = new Map(); // node id → cleanup for its live preview
  const dropPreview = (id) => { previews.get(id)?.(); previews.delete(id); };
  // One preview at a time takes the pointer (scrolling, playing, typing); the rest behave like cards on the canvas.
  let live = null;
  function setLive(id) {
    if (live === id) return;
    els.get(live)?.classList.remove('live');
    live = id && els.has(id) ? id : null;
    els.get(live)?.classList.add('live');
  }
  const smallBtn = (cls, name, label) => { const b = h('button', { class: `frame-btn ${cls}`, title: label, 'aria-label': label }); b.innerHTML = icon[name]; return b; };
  const resizeHandle = () => h('button', { class: 'node-resize', title: 'Drag to resize', 'aria-label': 'Resize' });
  function fill(el, n, multiLang) {
    const entering = el.classList.contains('enter');
    const framed = n.type === 'web' || (n.type === 'file' && n.kind !== 'image');
    el.className = `node ${n.type}${n.type === 'file' && n.kind === 'image' ? ' image-node' : ''}${framed ? ` frame-node kind-${n.type === 'web' ? 'web' : n.kind}` : ''}${n.parent == null ? ' is-root' : ''}${entering ? ' enter' : ''}`;
    dropPreview(n.id);
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
    } else if (n.type === 'file' && n.kind === 'image') {
      const src = fileUrl(projectId, n.file);
      const image = h('img', { class: 'file-full-image', src, alt: n.title, draggable: 'false', onload: () => refresh({ changed: false }) });
      el.append(image, smallBtn('frame-fullscreen image-fullscreen', 'fullscreen', 'Fullscreen'), resizeHandle());
    } else if (framed) {
      // Web pages and every attachment are live in the overview: a draggable bar on top, the content below.
      const glyph = h('span', { class: 'file-glyph' });
      glyph.innerHTML = n.type === 'web' ? icon.globe : n.kind === 'audio' ? icon.audio : icon.doc;
      const kind = n.type === 'web' ? hostOf(n.url) : n.kind === 'unsupported' ? 'Unsupported file' : n.kind.toUpperCase();
      const body = h('div', { class: 'frame-body' });
      el.append(
        h('div', { class: 'frame-bar' }, glyph,
          h('div', { class: 'txt' }, h('div', { class: 'title' }, n.title), h('div', { class: 'file-kind' }, kind)),
          smallBtn('frame-fullscreen', 'fullscreen', 'Fullscreen'), smallBtn('frame-open', 'open', 'Open large')),
        body, resizeHandle());
      previews.set(n.id, mountPreview(body, n, n.type === 'web' ? n.url : fileUrl(projectId, n.file)));
    } else {
      el.append(h('div', { class: 'title' }, n.title));
    }
  }
  // Buttons around a node change with its children; refilling them never reloads a live preview.
  function fillControls(el, n) {
    el.querySelectorAll(':scope > .del, :scope > .fold, :scope > .add').forEach((b) => b.remove());
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
      if (!set.has(id)) { dropPreview(id); el.remove(); els.delete(id); sigs.delete(id); csigs.delete(id); disp.delete(id); }
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
      const sig = JSON.stringify([n.type, n.title, n.description, n.thumbLocal || n.thumb, n.lang, n.file, n.kind, n.url, multiLang, n.parent == null]);
      const csig = JSON.stringify([n.collapsed, n.children.length, n.parent == null, sig]);
      if (sigs.get(id) !== sig) { fill(el, n, multiLang); sigs.set(id, sig); }
      if (csigs.get(id) !== csig) { fillControls(el, n); csigs.set(id, csig); }
      el.classList.toggle('last', sessionStorage.getItem(lastKey) === id);
    }
    for (const id of vis) {
      const el = els.get(id);
      N[id].w = el.offsetWidth * nodeScale(N[id]);
      N[id].h = el.offsetHeight * nodeScale(N[id]);
    }
    return vis;
  }

  // ---------- layout ----------
  /** Lay out each tree, then separate whole trees without changing their parent links. */
  function tidy() {
    const W = (id) => N[id].w || store.EST.w;
    const roots = project.roots || [project.rootId];
    const maxScale = visible().reduce((s, id) => Math.max(s, nodeScale(N[id])), 1);
    // Add/fold/delete controls extend outside the card; their clearance must grow with it.
    const gapX = Math.max(store.GAP_X, 32 * maxScale);
    const gapY = Math.max(store.GAP_Y, 32 * maxScale);
    const packed = [];
    let right = -Infinity; // right edge of the roots laid out so far; unplaced roots go after it
    for (const rootId of roots) {
      const widths = new Map();
      const measure = (id) => {
        const n = N[id];
        const kids = n.collapsed ? [] : n.children;
        let w = W(id);
        if (kids.length) w = Math.max(w, kids.reduce((s, c) => s + measure(c), 0) + gapX * (kids.length - 1));
        widths.set(id, w);
        return w;
      };
      measure(rootId);
      const rowH = [];
      const depth = new Map();
      const walk = (id, d) => {
        depth.set(id, d);
        rowH[d] = Math.max(rowH[d] || 0, N[id].h || store.EST.h);
        if (!N[id].collapsed) N[id].children.forEach((c) => walk(c, d + 1));
      };
      walk(rootId, 0);
      const rowY = [0];
      for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + gapY;
      const rootNode = N[rootId];
      const unplaced = rootNode.x == null && rootId !== roots[0];
      let ox = unplaced ? right + gapX * 2 + widths.get(rootId) / 2 : rootNode.x ?? 0;
      const oy = unplaced ? N[roots[0]].y ?? 0 : rootNode.y ?? 0;
      const footprint = { l: ox - widths.get(rootId) / 2 - gapX / 2, r: ox + widths.get(rootId) / 2 + gapX / 2,
        t: oy - gapX / 2, b: oy + rowY.at(-1) + rowH.at(-1) + gapX / 2 };
      for (;;) {
        const hits = packed.filter((b) => footprint.l < b.r && b.l < footprint.r && footprint.t < b.b && b.t < footprint.b);
        if (!hits.length) break;
        const dx = Math.max(...hits.map((b) => b.r)) + GAP - footprint.l;
        ox += dx; footprint.l += dx; footprint.r += dx;
      }
      packed.push(footprint);
      right = Math.max(right, ox + widths.get(rootId) / 2);
      const place = (id, left) => {
        const n = N[id];
        const nx = ox + left + widths.get(id) / 2;
        const ny = oy + rowY[depth.get(id)];
        if (n.x != null) store.shiftNodes(hiddenBelow(id), nx - n.x, ny - n.y);
        n.x = nx;
        n.y = ny;
        if (n.collapsed || !n.children.length) return;
        const sum = n.children.reduce((s, c) => s + widths.get(c), 0) + gapX * (n.children.length - 1);
        let x = left + (widths.get(id) - sum) / 2;
        for (const c of n.children) { place(c, x); x += widths.get(c) + gapX; }
      };
      place(rootId, -widths.get(rootId) / 2);
    }
  }

  function ensurePositions(vis) {
    if (N[project.rootId].x == null) { tidy(); return true; }
    let placed = false;
    for (const id of project.roots || []) {
      if (N[id].x != null) continue;
      const placedXs = vis.filter((v) => N[v].x != null).map((v) => N[v].x);
      N[id].x = Math.max(...placedXs) + store.EST.w + store.GAP_X * 2;
      N[id].y = N[project.rootId].y;
      placed = true;
    }
    for (const id of vis) {
      if (N[id].parent != null && N[id].x == null) { Object.assign(N[id], store.childSlot(N[N[id].parent])); placed = true; }
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
          const gap = Math.max(GAP, 16 * (nodeScale(A) + nodeScale(B)));
          const ox = Math.min(A.x + A.w / 2 + gap - (B.x - B.w / 2), B.x + B.w / 2 + gap - (A.x - A.w / 2));
          const oy = Math.min(A.y + A.h + gap - B.y, B.y + B.h + gap - A.y);
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
  function refresh({ pinned, animate = true, changed = false, arrange = false } = {}) {
    const vis = sync();
    const placed = arrange ? false : ensurePositions(vis);
    if (arrange) tidy();
    if ((!arrange && resolve(pinned)) || changed || placed || arrange) store.changed();
    // Resizing changes dimensions immediately: snap the new layout too, rather than
    // animating larger cards through their old neighbours.
    if (!animate || arrange) for (const id of visible()) disp.set(id, { x: N[id].x, y: N[id].y });
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
      el.style.transform = `translate(${d.x - n.w / 2}px, ${d.y}px) scale(${nodeScale(n)})`;
      el.style.setProperty('--node-scale', nodeScale(n));
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
    const k = Math.min(1.1, (r.width - 80) / bw, (r.height - 80) / bh);
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
  function resizeNodes(factor, id = null) {
    if (id) N[id].scale = Math.max(0.25, (N[id].scale || 1) * factor);
    else project.nodeScale = Math.max(0.25, (project.nodeScale || 1) * factor);
    refresh({ changed: true, arrange: true });
  }
  sizeDownBtn.onclick = () => resizeNodes(1 / 1.25);
  sizeUpBtn.onclick = () => resizeNodes(1.25);
  expandAllBtn.onclick = () => {
    setAllCollapsed(N, false);
    refresh({ changed: true, arrange: true });
  };
  shrinkAllBtn.onclick = () => {
    setAllCollapsed(N, true);
    refresh({ changed: true, arrange: true });
  };
  if (historyBtn) historyBtn.onclick = () => openHistory(api, projectId, async (entry) => {
    if (!(await confirmDialog(`Restore snapshot #${entry.seq}?`, 'Restore'))) return;
    await store.flush();
    await store.evict(projectId);
    await api.restoreSnapshot(projectId, entry.seq);
    navigate(`#/p/${projectId}`, { replace: true });
  });
  if (obsidianBtn) obsidianBtn.onclick = async () => {
    obsidianBtn.disabled = true;
    try {
      await store.flush();
      const { blob, filename } = await api.exportObsidian(projectId);
      const href = URL.createObjectURL(blob);
      const link = h('a', { href, download: filename, hidden: true });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) { showError(e.message); }
    finally { obsidianBtn.disabled = false; }
  };
  fitBtn.onclick = fit;
  arrangeBtn.onclick = () => refresh({ changed: true, arrange: true });

  function expandFive(id) {
    if (expandGenerations(N, id, 5)) {
      refresh({ changed: true, arrange: true });
      fit();
    }
  }
  function toggleFold(id) {
    if (N[id].collapsed) expandFive(id);
    else { N[id].collapsed = true; refresh({ changed: true, arrange: true }); }
  }

  // ---------- search (Ctrl+F / Cmd+F or the magnifier): go to a node, opening the folded branches above it ----------
  async function findNode() {
    closeMenus();
    const id = await searchNodes((q) => findNodes(project, q).map((x) => N[x]), (file) => fileUrl(projectId, file));
    if (id && N[id] && view.isConnected) goTo(id);
  }
  function goTo(id) {
    if (expandAncestors(N, id)) refresh({ changed: true, arrange: true });
    const n = N[id];
    const r = viewport.getBoundingClientRect();
    // Centred at 100% or closer; zoomed out only as far as needed to show a large node whole.
    const k = Math.min(Math.max(t.k, 1), (r.width - 80) / n.w, (r.height - 80) / n.h);
    t = { k, x: r.width / 2 - n.x * k, y: r.height / 2 - (n.y + n.h / 2) * k };
    apply();
    flash(id);
  }
  searchBtn.onclick = findNode;
  const isFind = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
    && (e.key.toLowerCase() === 'f' || (!/^[a-z]$/i.test(e.key) && e.code === 'KeyF')); // non-Latin layouts

  // ---------- pointer: pan, drag, drop ----------
  let pan = null;
  let press = null;
  let resizing = null;
  let suppressClick = false;
  // A dragged node carries its branch along; the first node moves on its own
  // (carrying the whole tree would just be panning).
  const moving = (id) => (id === project.rootId ? [id] : store.subtree(id).filter((x) => N[x].x != null));

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    closeMenus();
    const handle = e.target.closest('.node-resize');
    if (handle) {
      // Corner drag rescales the node from its top-left corner; the release saves it and moves neighbours aside.
      e.preventDefault();
      const id = handle.closest('.node').dataset.id;
      const r = els.get(id).getBoundingClientRect();
      resizing = { id, sx: e.clientX, sy: e.clientY, w: r.width, h: r.height, scale: N[id].scale || 1, left: (disp.get(id)?.x ?? N[id].x) - N[id].w / 2 };
      els.get(id).classList.add('resizing');
      return;
    }
    const el = e.target.closest('.node');
    if (el) {
      // A live preview is used in place; an inactive one drags like any card (its content ignores the pointer).
      if (e.target.closest('button, input, select, audio, video, .frame-node.live .frame-body')) return;
      press = { id: el.dataset.id, sx: e.clientX, sy: e.clientY, started: false };
      return;
    }
    pan = { x: e.clientX - t.x, y: e.clientY - t.y };
    viewport.classList.add('panning');
  });

  const onMove = (e) => {
    if (resizing) {
      const ratio = Math.max((resizing.w + e.clientX - resizing.sx) / resizing.w, (resizing.h + e.clientY - resizing.sy) / resizing.h);
      N[resizing.id].scale = Math.min(MAX_NODE_SCALE, Math.max(MIN_NODE_SCALE, resizing.scale * ratio));
      kick(); // frame() keeps the stale width, so the left edge stays put while the scale changes
      return;
    }
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
    const p = toCanvas(e.clientX, e.clientY);
    for (const [id] of els) {
      if (drag.ids.has(id)) continue;
      const n = N[id];
      if (p.x >= n.x - n.w / 2 - 6 && p.x <= n.x + n.w / 2 + 6 && p.y >= n.y - 6 && p.y <= n.y + n.h + 6) target = id;
    }
    if (target !== dropTarget) {
      if (dropTarget) els.get(dropTarget)?.classList.remove('drop');
      dropTarget = target;
      if (dropTarget) els.get(dropTarget)?.classList.add('drop');
    }
    kick();
  };

  const onUp = () => {
    if (resizing) {
      const { id, left } = resizing;
      const el = els.get(id);
      el.classList.remove('resizing');
      resizing = null;
      N[id].x = left + (el.offsetWidth * nodeScale(N[id])) / 2;
      disp.set(id, { x: N[id].x, y: N[id].y });
      refresh({ pinned: new Set([id]), changed: true });
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      return;
    }
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
    if (e.target.closest?.('.frame-node.live .frame-body')) return; // a live preview scrolls its own content
    e.preventDefault();
    if (e.shiftKey) { t.x -= e.deltaY + e.deltaX; apply(); return; }
    const r = viewport.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const k = Math.min(2.2, t.k * Math.exp(-e.deltaY * 0.0015));
    if (!(k > 0) || !Number.isFinite(k)) return;
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
    if (e.target.closest('.fold')) { toggleFold(n.id); return; }
    if (e.target.closest('.frame-fullscreen')) {
      setLive(n.id); // fullscreen content must take the pointer
      const el2 = els.get(n.id);
      const target = el2.querySelector('.frame-body') ? fullscreenTarget(el2.querySelector('.frame-body')) : el2.querySelector('.file-full-image');
      toggleFullscreen(target).catch((err) => showError(err.message));
      return;
    }
    if (e.target.closest('.frame-open')) { open(n.id); return; }
    if (e.target.closest('input, select, .node-resize')) return;
    if (e.target.closest('.frame-body')) { setLive(n.id); return; }
    if (isOpenable(n)) open(n.id);
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
  viewport.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node')) return;
    e.preventDefault();
    closeMenus();
    addIndependent(toCanvas(e.clientX, e.clientY));
  });

  function open(id) {
    sessionStorage.setItem(lastKey, id);
    navigate(`#/p/${projectId}/w/${id}`);
  }

  const pickedData = (c) => c.type === 'wiki'
    ? { type: 'wiki', title: c.title, lang: c.lang, description: c.description, thumb: c.thumb }
    : c.type === 'web' ? { type: 'web', title: c.title, url: c.url }
      : { type: 'header', title: c.title };

  async function addChild(parentId) {
    const c = await pickNode();
    if (!c || !view.isConnected) return;
    if (c.type === 'file') {
      let first = null;
      for (const filePath of c.paths) {
        try {
          const f = await api.importFile(projectId, filePath);
          const n = store.addNode(parentId, f);
          first ||= n;
        } catch (e) { showError(e.message); }
      }
      refresh({ changed: true });
      if (first) { reveal(first.id); flash(first.id); }
      repaintSaveAll();
      return;
    }
    if (c.type === 'wiki') {
      const dup = store.findChildByTitle(parentId, c.title, c.lang);
      if (dup) { flash(dup.id); return; }
    }
    const n = store.addNode(parentId, pickedData(c));
    refresh({ changed: true });
    reveal(n.id);
    flash(n.id);
    repaintSaveAll();
  }

  async function addIndependent(position) {
    const c = await pickNode();
    if (!c || !view.isConnected) return;
    if (c.type === 'file') {
      let last = null;
      for (const filePath of c.paths) {
        try { last = store.addIndependentNode(await api.importFile(projectId, filePath), position); }
        catch (e) { showError(e.message); }
      }
      refresh({ changed: true });
      if (last) { reveal(last.id); flash(last.id); }
      repaintSaveAll();
      return;
    }
    const n = store.addIndependentNode(pickedData(c), position);
    refresh({ changed: true });
    reveal(n.id);
    flash(n.id);
    repaintSaveAll();
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
    await api.collectFiles(projectId).catch(() => {});
    repaintSaveAll();
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
  const onDocDown = (e) => {
    if (menu && !menu.contains(e.target)) closeMenus();
    if (live && !els.get(live)?.contains(e.target) && !document.fullscreenElement) setLive(null);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { closeMenus(); setLive(null); }
    if (isFind(e)) {
      e.preventDefault();
      const open = document.querySelector('.node-search .pop-input');
      if (open) { open.focus(); open.select(); } // already searching
      else if (!document.querySelector('.modal-back') && !document.fullscreenElement) findNode();
    }
  };
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey);

  function detach(id) {
    // The branch stays where it is; only overlaps with its old neighbours are resolved.
    if (!store.detachNode(id)) return;
    refresh({ pinned: new Set(store.subtree(id)), changed: true });
    flash(id);
  }

  function contextMenu(n, x, y) {
    closeMenus();
    const items = [
      isOpenable(n) && ['Open', () => open(n.id)],
      n.type === 'header' && ['Rename', () => rename(n.id)],
      ['Add below', () => addChild(n.id)],
      n.parent != null && ['Remove from Parent Node', () => detach(n.id)],
      n.children.length && [n.collapsed ? 'Expand' : 'Collapse', () => toggleFold(n.id)],
      (n.parent != null || n.id !== project.rootId) && ['Delete', () => remove(n.id), 'danger'],
    ].filter(Boolean);
    menu = h('div', { class: 'ctx' }, ...items.map(([label, fn, cls]) =>
      h('button', { class: cls || '', onclick: () => { closeMenus(); fn(); } }, label)));
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  }

  // ---------- download all (for offline reading) ----------
  // Green = something left to download. Normal colour and not clickable = all downloaded (✓),
  // nothing to download, or no internet.
  const uniqueWikis = () => {
    const seen = new Map();
    for (const n of store.wikiNodes()) seen.set(`${n.lang}:${n.title.toLowerCase()}`, n);
    return [...seen.values()];
  };
  async function paintSaveAll() {
    if (webExport) {
      if (view.isConnected && !saveAllBtn.classList.contains('busy')) {
        saveAllBtn.innerHTML = icon.save;
        saveAllBtn.classList.add('ready');
        saveAllBtn.disabled = false;
        saveAllBtn.title = 'Download .wt project';
      }
      return { wikis: [], state: [] };
    }
    const wikis = uniqueWikis();
    const state = wikis.length ? await api.savedState(projectId, wikis.map((n) => ({ lang: n.lang, title: n.title }))) : [];
    if (saveAllBtn.classList.contains('busy') || !view.isConnected) return { wikis, state };
    const all = wikis.length > 0 && state.every(Boolean);
    const ready = !all && wikis.length > 0 && navigator.onLine;
    saveAllBtn.innerHTML = all ? icon.saved : icon.save;
    saveAllBtn.classList.toggle('ready', ready);
    saveAllBtn.disabled = !ready;
    saveAllBtn.title = all ? 'Downloaded' : !navigator.onLine ? 'No internet connection' : wikis.length ? 'Download all' : 'Nothing to download';
    return { wikis, state };
  }
  const repaintSaveAll = () => { paintSaveAll().catch(() => {}); };
  repaintSaveAll();
  window.addEventListener('online', repaintSaveAll, { signal: listeners.signal });
  window.addEventListener('offline', repaintSaveAll, { signal: listeners.signal });
  saveAllBtn.onclick = async () => {
    if (saveAllBtn.classList.contains('busy') || saveAllBtn.disabled) return;
    if (webExport) {
      saveAllBtn.classList.add('busy');
      saveAllBtn.disabled = true;
      try {
        await store.flush();
        const { blob, filename } = await api.exportProject(projectId);
        const href = URL.createObjectURL(blob);
        const link = h('a', { href, download: filename, hidden: true });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
      } catch (e) { showError(e.message); }
      finally {
        saveAllBtn.classList.remove('busy');
        saveAllBtn.disabled = false;
        saveAllBtn.classList.add('ready');
      }
      return;
    }
    const { wikis, state } = await paintSaveAll();
    const todo = wikis.filter((_, i) => !state[i]);
    if (!todo.length) return;
    saveAllBtn.classList.add('busy');
    saveAllBtn.disabled = true;
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
    progress.remove();
    if (view.isConnected) { refresh(); repaintSaveAll(); }
  };

  return () => {
    listeners.abort();
    for (const id of [...previews.keys()]) dropPreview(id);
    view.querySelectorAll('audio, video').forEach((media) => media.pause());
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
