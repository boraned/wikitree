// Wiki reader: cleaned Wikipedia article; blue links become child nodes.
import { api, cachedSummary, showError, isOffline, fileUrl } from '../lib/api.js';
import { navigate, goBack } from '../app.js';
import { h, iconBtn, icon } from '../lib/dom.js';
import { cleanArticle, saveOffline } from '../lib/clean.js';
import * as store from '../lib/store.js';
import { mountPreview, fullscreenTarget, toggleFullscreen, hostOf } from '../lib/previews.js';
import { mountFamily } from '../lib/family.js';

const scrollMemory = new Map();

export async function renderReader(root, projectId, nodeId) {
  const project = await store.loadProject(projectId);
  const node = project.nodes[nodeId];
  if (!node || !['wiki', 'file', 'web'].includes(node.type)) throw new Error('Page not found in this project');
  if (node.type !== 'wiki') return renderDocument(root, projectId, node, project);
  const lang = node.lang || 'en';
  const treeHash = `#/p/${projectId}`;
  sessionStorage.setItem(`wt-last-${projectId}`, nodeId);
  const listeners = new AbortController(); // window listeners, removed when leaving the page

  // ---------- chrome ----------
  const treeBtn = iconBtn('tree', 'Back to the overview', 'icon-btn tree-btn');
  const saveBtn = iconBtn('save', 'Save offline', 'icon-btn save-btn');
  saveBtn.disabled = true;
  const crumbs = h('nav', { class: 'crumbs family' });
  const bar = h('i');
  const toc = h('nav', { class: 'toc' });
  const body = h('div', { class: 'wiki-body' });
  const titleEl = h('h1', { class: 'page-title' }, node.title);
  const article = h('article', { class: 'article', lang },
    titleEl,
    node.description ? h('div', { class: 'page-desc' }, node.description) : null,
    body);
  const scroller = h('div', { class: 'reader-scroll' }, h('div', { class: 'reader-grid' }, toc, article));
  const loading = h('div', { class: 'loading' }, h('span'), h('span'), h('span'));
  body.append(loading);
  const view = h('div', { class: 'reader' },
    h('div', { class: 'topbar' }, crumbs, h('div', { class: 'spacer' }), saveBtn, treeBtn),
    h('div', { class: 'progress' }, bar),
    scroller);
  root.append(view);

  treeBtn.onclick = () => navigate(treeHash);
  const family = mountFamily(crumbs, projectId, nodeId);
  const renderCrumbs = family.render;

  // ---------- content ----------
  let page;
  let html;
  try {
    const [p, ns] = await Promise.all([api.page(node.title, lang, projectId), api.namespaces(lang).catch(() => [])]);
    page = p;
    if (page.cleaned) {
      html = page.html;
      article.dir = page.dir || 'ltr';
    } else {
      const c = cleanArticle(page.html, ns);
      html = c.html;
      article.dir = c.dir;
    }
  } catch (e) {
    loading.remove();
    listeners.signal.addEventListener('abort', family.dispose);
    body.append(h('div', { class: 'load-error' }, isOffline(e) ? 'No internet connection' : e.message,
      h('button', { class: 'btn-ghost', onclick: () => location.reload() }, 'Retry')));
    return () => {};
  }
  if (!view.isConnected) return () => {};
  if (page.title !== node.title) {
    store.renameNode(nodeId, page.title);
    titleEl.textContent = page.title;
    renderCrumbs();
  }

  loading.remove();
  body.innerHTML = html;
  // Wikipedia text is CC BY-SA: credit the source and licence under every article.
  const source = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
  const credit = h('footer', { class: 'attribution', dir: 'ltr' },
    h('a', { href: source }, 'Wikipedia'), ' · ',
    h('a', { href: 'https://creativecommons.org/licenses/by-sa/4.0/' }, 'CC BY-SA 4.0'));
  credit.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) { e.preventDefault(); api.openExternal(a.href); }
  });
  article.append(credit);
  markInTree();
  buildToc();
  scroller.scrollTop = scrollMemory.get(nodeId) || 0;

  function markInTree() {
    const kids = new Set(node.children.map((c) => project.nodes[c]).filter((c) => c?.type === 'wiki' && c.lang === lang).map((c) => c.title.toLowerCase()));
    body.querySelectorAll('a.wl').forEach((a) => a.classList.toggle('in-tree', kids.has(a.dataset.title.toLowerCase())));
  }

  function buildToc() {
    const heads = [...body.querySelectorAll('h2, h3')].filter((x) => x.id && x.textContent.trim());
    if (heads.length < 2) { toc.remove(); return; }
    toc.dir = article.dir;
    toc.append(h('div', { class: 'toc-title' }, 'Contents'),
      ...heads.map((hd) => h('a', { class: `toc-${hd.tagName.toLowerCase()}`, 'data-target': hd.id }, hd.textContent.trim())));
    toc.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-target]');
      if (a) scrollToId(a.dataset.target);
    });
    toc._heads = heads;
  }

  function scrollToId(id) {
    const el = body.querySelector(`[id="${CSS.escape(id)}"]`);
    if (el) scroller.scrollTo({ top: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16, behavior: 'smooth' });
  }

  // ---------- download (for offline reading) ----------
  // Green = can be downloaded. Normal colour and not clickable = already downloaded (✓) or no internet.
  let saved = page.saved === true;
  const paintSave = () => {
    const online = navigator.onLine;
    saveBtn.innerHTML = saved ? icon.saved : icon.save;
    saveBtn.classList.toggle('ready', !saved && online);
    saveBtn.disabled = saved || !online;
    saveBtn.title = saved ? 'Downloaded' : online ? 'Download' : 'No internet connection';
  };
  paintSave();
  window.addEventListener('online', paintSave, { signal: listeners.signal });
  window.addEventListener('offline', paintSave, { signal: listeners.signal });
  saveBtn.onclick = async () => {
    if (saved || saveBtn.classList.contains('busy')) return;
    saveBtn.disabled = true;
    saveBtn.classList.add('busy');
    try {
      const r = await saveOffline(api, projectId, node);
      if (r.thumbLocal) { node.thumbLocal = r.thumbLocal; store.changed(); }
      saved = true;
    } catch (e) {
      showError(isOffline(e) ? 'No internet connection' : e.message);
    } finally {
      saveBtn.classList.remove('busy');
      paintSave();
    }
  };

  // ---------- scrolling: progress + toc highlight ----------
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const max = scroller.scrollHeight - scroller.clientHeight;
      bar.style.width = `${max > 0 ? (scroller.scrollTop / max) * 100 : 0}%`;
      const heads = toc._heads;
      if (!heads) return;
      const top = scroller.getBoundingClientRect().top + 90;
      let active = heads[0];
      for (const hd of heads) if (hd.getBoundingClientRect().top <= top) active = hd;
      toc.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.target === active.id));
    });
  };
  scroller.addEventListener('scroll', onScroll);
  onScroll();

  // ---------- links ----------
  async function follow(a, { stay = false } = {}) {
    const title = a.dataset.title;
    if (title.toLowerCase() === node.title.toLowerCase()) return a.dataset.frag && scrollToId(a.dataset.frag.replace(/ /g, '_'));
    const known = store.findChildByTitle(nodeId, title, lang);
    if (known && !stay) return go(known.id);
    if (a.classList.contains('pending')) return;
    a.classList.add('pending');
    try {
      const s = await cachedSummary(title, lang);
      if (s.title.toLowerCase() === node.title.toLowerCase()) return;
      const child = store.findChildByTitle(nodeId, s.title, lang)
        || store.addNode(nodeId, { type: 'wiki', title: s.title, lang, description: s.description, thumb: s.thumb });
      markInTree();
      renderCrumbs();
      body.querySelectorAll('a.wl').forEach((x) => { if (x.dataset.title.toLowerCase() === title.toLowerCase()) x.classList.add('in-tree'); });
      if (!stay) go(child.id);
    } catch (e) {
      showError(isOffline(e) ? 'No internet connection' : e.message);
    } finally {
      a.classList.remove('pending');
    }
  }
  const go = (id) => navigate(`${treeHash}/w/${id}`);

  body.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a?.classList.contains('wl')) {
      e.preventDefault();
      hidePreview();
      follow(a, { stay: e.ctrlKey || e.metaKey });
    } else if (a?.classList.contains('anchor')) {
      e.preventDefault();
      scrollToId(a.getAttribute('href').slice(1));
    } else if (a?.classList.contains('ext')) {
      e.preventDefault();
      api.openExternal(a.href);
    } else if (a) {
      e.preventDefault();
    }
    const img = e.target.closest('img');
    if (img && !a?.classList.contains('wl')) lightbox(img);
  });
  // Middle click: branch without leaving the page.
  body.addEventListener('auxclick', (e) => {
    const a = e.target.closest('a.wl');
    if (a && e.button === 1) { e.preventDefault(); follow(a, { stay: true }); }
  });

  // ---------- hover previews ----------
  let previewEl = null;
  let hoverTimer = null;
  let hoverLink = null;
  function hidePreview() {
    clearTimeout(hoverTimer);
    hoverLink = null;
    previewEl?.remove();
    previewEl = null;
  }
  body.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a.wl');
    if (!a || a === hoverLink) return;
    hidePreview();
    hoverLink = a;
    hoverTimer = setTimeout(async () => {
      try {
        const s = await cachedSummary(a.dataset.title, lang);
        if (hoverLink !== a || !s.extract) return;
        previewEl = h('div', { class: 'preview', dir: article.dir, lang },
          s.thumb ? h('img', { src: s.thumb, alt: '' }) : null,
          h('div', { class: 'pv-body' },
            h('div', { class: 'pv-title' }, s.title),
            h('div', { class: 'pv-text' }, s.extract)));
        document.body.append(previewEl);
        const r = a.getBoundingClientRect();
        const pr = previewEl.getBoundingClientRect();
        const below = r.bottom + pr.height + 12 < innerHeight;
        previewEl.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pr.width - 8))}px`;
        previewEl.style.top = `${below ? r.bottom + 8 : r.top - pr.height - 8}px`;
      } catch { /* no preview offline */ }
    }, 450);
  });
  body.addEventListener('mouseout', (e) => {
    const a = e.target.closest('a.wl');
    if (a && !a.contains(e.relatedTarget)) hidePreview();
  });
  scroller.addEventListener('scroll', hidePreview, { passive: true });

  // ---------- image lightbox ----------
  function lightbox(img) {
    const set = img.getAttribute('srcset');
    const src = set ? set.split(',').map((s) => s.trim().split(/\s+/)[0]).pop() : img.src;
    const box = h('div', { class: 'lightbox' }, h('img', { src, alt: '' }));
    const close = () => { box.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => e.key === 'Escape' && close();
    box.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    document.body.append(box);
  }

  // ---------- back via keyboard / mouse ----------
  const onKey = (e) => { if (e.altKey && e.key === 'ArrowLeft') goBack(treeHash); };
  const onMouse = (e) => { if (e.button === 3) { e.preventDefault(); goBack(treeHash); } };
  document.addEventListener('keydown', onKey);
  window.addEventListener('mouseup', onMouse);

  return () => {
    listeners.abort();
    family.dispose();
    scrollMemory.set(nodeId, scroller.scrollTop);
    hidePreview();
    document.querySelector('.lightbox')?.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('mouseup', onMouse);
    store.flush();
  };
}

// Attachments and web pages, enlarged. The same live previews as the overview, filling the window.
async function renderDocument(root, projectId, node) {
  const treeHash = `#/p/${projectId}`;
  sessionStorage.setItem(`wt-last-${projectId}`, node.id);
  const treeBtn = iconBtn('tree', 'Back to the overview', 'icon-btn tree-btn');
  const fullscreenBtn = iconBtn('fit', 'Fullscreen', 'icon-btn file-fullscreen');
  const events = new AbortController();
  const crumbs = h('nav', { class: 'crumbs family' });
  const body = h('div', { class: `reader-preview kind-${node.type === 'web' ? 'web' : node.kind}` });
  const tools = [];
  if (node.type === 'web') {
    const reload = iconBtn('reload', 'Reload page', 'icon-btn web-reload');
    const external = iconBtn('open', 'Open in browser', 'icon-btn web-external');
    reload.onclick = () => { const f = body.querySelector('iframe'); if (f) f.src = node.url; };
    external.onclick = () => api.openExternal(node.url).catch((e) => showError(e.message));
    tools.push(h('span', { class: 'web-address', title: node.url }, hostOf(node.url)), reload, external);
  }
  const view = h('div', { class: 'reader document-reader' },
    h('div', { class: 'topbar' }, crumbs, h('div', { class: 'spacer' }), ...tools, fullscreenBtn, treeBtn),
    h('div', { class: 'document-scroll' }, body));
  root.append(view);
  treeBtn.onclick = () => navigate(treeHash);
  const family = mountFamily(crumbs, projectId, node.id);
  fullscreenBtn.onclick = () => toggleFullscreen(fullscreenTarget(body)).catch((e) => showError(e.message));
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    fullscreenBtn.setAttribute('aria-label', fullscreenBtn.title);
  }, { signal: events.signal });
  const dispose = mountPreview(body, node, node.type === 'web' ? node.url : fileUrl(projectId, node.file));
  return () => {
    events.abort();
    family.dispose();
    dispose();
    view.remove();
  };
}
