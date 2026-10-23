// Wiki reader: cleaned Wikipedia article; blue links become child nodes.
import { api, cachedSummary, showError } from './api.js';
import { navigate, goBack } from './app.js';
import { h, iconBtn } from './dom.js';
import * as store from './store.js';

const scrollMemory = new Map();

const JUNK = [
  'script', 'style', 'link', 'meta', 'noscript',
  '.mw-editsection', '.navbox', '.navbox-styles', '.vertical-navbox', '.sidebar', '.ambox', '.ombox', '.tmbox',
  '.mbox-small', '.metadata', '.sistersitebox', '.side-box', '.portalbox', '.hatnote', '.dablink',
  '.shortdescription', '.noprint', '.mw-empty-elt', '.reflist', '.refbegin', '.mw-references-wrap',
  'sup.reference', 'sup.mw-ref', '.mw-ref', '.reference', '.catlinks', '[role="navigation"]',
  '.authority-control', '.stub', '.asbox', '.mw-indicators', '.mw-kartographer-maplink', '.ext-phonos',
];
const JUNK_SECTIONS = /^(see also|notes|references|sources|external links|further reading|bibliography|citations|footnotes|notes and references|references and notes|works cited|explanatory notes|general and cited sources|general sources|cited sources|primary sources|secondary sources|other sources|literature|selected bibliography|gallery)$/i;
const NON_ARTICLE = /^(file|image|media|category|help|special|wikipedia|wp|template|talk|portal|user|module|draft|mediawiki|book|timedtext|wikt|wiktionary|commons|s|q|n|b|v|voy|species|d|mw|meta|wikisource|wikiquote|wikinews|wikibooks|wikiversity|wikivoyage|wikidata)( talk)?:/i;

export async function renderReader(root, projectId, nodeId) {
  const project = await store.loadProject(projectId);
  const node = project.nodes[nodeId];
  if (!node || node.type !== 'wiki') throw new Error('Page not found in this project');
  const treeHash = `#/p/${projectId}`;
  sessionStorage.setItem(`wt-last-${projectId}`, nodeId);

  // ---------- chrome ----------
  const backBtn = iconBtn('back', 'Back', 'icon-btn back');
  const treeBtn = iconBtn('tree', 'Tree');
  const crumbs = h('nav', { class: 'crumbs' });
  const bar = h('i');
  const toc = h('nav', { class: 'toc' });
  const body = h('div', { class: 'wiki-body' });
  const article = h('article', { class: 'article' },
    h('h1', { class: 'page-title' }, node.title),
    node.description ? h('div', { class: 'page-desc' }, node.description) : null,
    body);
  const scroller = h('div', { class: 'reader-scroll' }, h('div', { class: 'reader-grid' }, toc, article));
  const loading = h('div', { class: 'loading' }, h('span'), h('span'), h('span'));
  body.append(loading);
  const view = h('div', { class: 'reader' },
    h('div', { class: 'topbar' }, backBtn, crumbs, h('div', { class: 'spacer' }), treeBtn),
    h('div', { class: 'progress' }, bar),
    scroller);
  root.append(view);

  backBtn.onclick = () => goBack(treeHash);
  treeBtn.onclick = () => navigate(treeHash);
  renderCrumbs();

  function renderCrumbs() {
    const path = store.pathTo(nodeId);
    let items = path.map((n) => ({ n }));
    if (items.length > 5) items = [items[0], { gap: true }, ...items.slice(-3)];
    crumbs.replaceChildren(...items.flatMap((it, i) => {
      const sep = i ? [h('span', { class: 'sep' }, '›')] : [];
      if (it.gap) return [...sep, h('span', { class: 'gap' }, '…')];
      const n = it.n;
      const isCur = n.id === nodeId;
      const b = h('button', { class: `crumb ${n.type}${isCur ? ' cur' : ''}` }, n.title);
      if (!isCur) b.onclick = () => navigate(n.type === 'wiki' ? `${treeHash}/w/${n.id}` : treeHash);
      return [...sep, b];
    }));
  }

  // ---------- content ----------
  let page;
  try {
    page = await api.page(node.title);
  } catch (e) {
    loading.remove();
    body.append(h('div', { class: 'load-error' }, e.message, h('button', { class: 'btn-ghost', onclick: () => location.reload() }, 'Retry')));
    return () => {};
  }
  if (!view.isConnected) return () => {};
  if (page.title !== node.title) {
    store.renameNode(nodeId, page.title);
    article.querySelector('.page-title').textContent = page.title;
    renderCrumbs();
  }

  const doc = new DOMParser().parseFromString(page.html, 'text/html');
  clean(doc);
  loading.remove();
  body.append(...doc.body.childNodes);
  markInTree();
  buildToc();
  scroller.scrollTop = scrollMemory.get(nodeId) || 0;

  function clean(d) {
    d.querySelectorAll(JUNK.join(',')).forEach((el) => el.remove());
    d.querySelectorAll('h2').forEach((hd) => {
      if (JUNK_SECTIONS.test(hd.textContent.trim())) (hd.closest('section') || hd).remove();
    });
    // Absolute media URLs.
    const abs = (u) => u.replace(/(^|,\s*)\/\//g, '$1https://');
    d.querySelectorAll('img, video, audio, source').forEach((el) => {
      for (const a of ['src', 'srcset', 'poster']) if (el.getAttribute(a)) el.setAttribute(a, abs(el.getAttribute(a)));
      if (el.tagName === 'IMG') {
        el.loading = 'lazy';
        if (/\.(svg|png|gif)/i.test(el.getAttribute('src') || '')) el.classList.add('tr');
      }
    });
    // Links.
    d.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const rel = a.getAttribute('rel') || '';
      if (a.classList.contains('mw-file-description') || a.querySelector('img')) {
        a.removeAttribute('href');
        a.className = 'img-link';
      } else if (href.startsWith('#')) {
        a.className = 'anchor';
      } else if (rel.includes('mw:WikiLink') && href.startsWith('./') && !rel.includes('Interwiki')) {
        const [raw, frag] = href.slice(2).split('#');
        const title = decodeURIComponent(raw).replace(/_/g, ' ');
        if (a.classList.contains('new') || NON_ARTICLE.test(title) || href.includes('redlink=1')) {
          a.replaceWith(...a.childNodes);
        } else {
          a.className = 'wl';
          a.dataset.title = title;
          if (frag) a.dataset.frag = decodeURIComponent(frag);
          a.removeAttribute('title');
        }
      } else if (/^(https?:)?\/\//.test(href)) {
        a.className = 'ext';
        a.setAttribute('href', href.startsWith('//') ? `https:${href}` : href);
      } else {
        a.replaceWith(...a.childNodes);
      }
    });
    fixColors(d);
    // Wide tables scroll sideways instead of being clipped.
    d.querySelectorAll('table:not(.infobox)').forEach((tb) => {
      if (tb.parentElement?.closest('table')) return;
      const wrap = d.createElement('div');
      wrap.className = 'table-wrap';
      tb.replaceWith(wrap);
      wrap.append(tb);
    });
    d.querySelectorAll('[data-mw], [data-mw-section-id], [about], [typeof]').forEach((el) => {
      el.removeAttribute('data-mw');
      el.removeAttribute('about');
    });
  }

  function markInTree() {
    const kids = new Set(node.children.map((c) => project.nodes[c]).filter((c) => c?.type === 'wiki').map((c) => c.title.toLowerCase()));
    body.querySelectorAll('a.wl').forEach((a) => a.classList.toggle('in-tree', kids.has(a.dataset.title.toLowerCase())));
  }

  function buildToc() {
    const heads = [...body.querySelectorAll('h2, h3')].filter((x) => x.id && x.textContent.trim());
    if (heads.length < 2) { toc.remove(); return; }
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
    const known = store.findChildByTitle(nodeId, title);
    if (known && !stay) return go(known.id);
    if (a.classList.contains('pending')) return;
    a.classList.add('pending');
    try {
      const s = await cachedSummary(title);
      if (s.title.toLowerCase() === node.title.toLowerCase()) return;
      const child = store.findChildByTitle(nodeId, s.title)
        || store.addNode(nodeId, { type: 'wiki', title: s.title, description: s.description, thumb: s.thumb });
      markInTree();
      body.querySelectorAll('a.wl').forEach((x) => { if (x.dataset.title.toLowerCase() === title.toLowerCase()) x.classList.add('in-tree'); });
      if (!stay) go(child.id);
    } catch (e) {
      showError(e.message);
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
        const s = await cachedSummary(a.dataset.title);
        if (hoverLink !== a || !s.extract) return;
        previewEl = h('div', { class: 'preview' },
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
      } catch { /* no preview */ }
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
  const onKey = (e) => {
    if (e.altKey && e.key === 'ArrowLeft') goBack(treeHash);
  };
  const onMouse = (e) => { if (e.button === 3) { e.preventDefault(); goBack(treeHash); } };
  document.addEventListener('keydown', onKey);
  window.addEventListener('mouseup', onMouse);

  return () => {
    scrollMemory.set(nodeId, scroller.scrollTop);
    hidePreview();
    document.querySelector('.lightbox')?.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('mouseup', onMouse);
    store.flush();
  };
}

// ---------- dark-mode colour fixes for inline styles ----------
const probe = document.createElement('div');
const colorCache = new Map();
function rgba(value) {
  if (!value) return null;
  if (!colorCache.has(value)) {
    probe.style.color = '';
    probe.style.color = value;
    if (!probe.style.color) { colorCache.set(value, null); return null; }
    document.body.append(probe);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number);
    probe.remove();
    colorCache.set(value, m ? { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } : null);
  }
  return colorCache.get(value);
}
const lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function fixColors(d) {
  d.querySelectorAll('[style*="background"], [bgcolor]').forEach((el) => {
    const c = rgba(el.style.backgroundColor || el.getAttribute('bgcolor') || (el.style.background.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b[a-z]+\b/i) || [])[0]);
    if (!c || c.a === 0) return;
    const L = lum(c);
    if (L > 0.86) {
      el.style.background = 'transparent';
      el.removeAttribute('bgcolor');
    } else if (L > 0.42) {
      el.classList.add('on-light');
    }
  });
  d.querySelectorAll('[style*="color"]').forEach((el) => {
    if (el.closest('.on-light')) return;
    const c = rgba(el.style.color);
    if (c && lum(c) < 0.4) el.style.color = '';
  });
}
