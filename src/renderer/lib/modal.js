// Centered in-app dialogs: confirm and the add-node picker (Wikipedia · web · header · file).
import { api, LANGS, getLang, setLang, isOffline, cachedSummary } from './api.js';
import { h, icon } from './dom.js';
import { MAX_FILE_SIZE } from './file-types.js';

export { FILE_TYPES } from './file-types.js';

function openModal(content, cls = '') {
  const box = h('div', { class: `modal ${cls}`, role: 'dialog' }, content);
  const back = h('div', { class: 'modal-back' }, box);
  let onClose = () => {};
  const close = (value) => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose(value);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { box, close, set onClose(fn) { onClose = fn; } };
}

/** In-app yes/no. Resolves true when confirmed. */
export function confirmDialog(text, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const cancel = h('button', { class: 'btn-ghost' }, 'Cancel');
    const ok = h('button', { class: 'btn-danger' }, okLabel);
    const m = openModal(h('div', { class: 'confirm' },
      h('div', { class: 'confirm-text' }, text),
      h('div', { class: 'confirm-row' }, cancel, ok)), 'small');
    m.onClose = (v) => resolve(v === true);
    cancel.onclick = () => m.close(false);
    ok.onclick = () => m.close(true);
    ok.focus();
  });
}

/** A typed or pasted web address, normalised to https:// when the scheme is missing; otherwise null. */
export function asWebUrl(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return null;
  const candidate = /^https?:\/\//i.test(t) ? t : /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(t) ? `https://${t}` : null;
  if (!candidate) return null;
  try { const u = new URL(candidate); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') || u.hostname === 'localhost' ? u.href : null; } catch { return null; }
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/**
 * Lets the user choose a Wikipedia article, a web page, a header or files.
 * Resolves { type:'wiki', title, lang, description, thumb } | { type:'web', url, title } | { type:'header', title }
 * | { type:'file', paths: [...] } | null.
 */
export function pickNode() {
  return new Promise((resolve) => {
    let mode = 'wiki';
    let lang = getLang();
    let results = [];
    let sel = 0;
    let seq = 0;
    let timer = null;

    const tab = (name, label, svg) => {
      const b = h('button', { class: `tab tab-${name}`, title: label, 'aria-label': label });
      b.innerHTML = svg;
      return b;
    };
    const hasWeb = typeof api.webSearch === 'function';
    const tabs = {
      wiki: tab('wiki', 'Wikipedia', icon.wikipedia),
      ...(hasWeb ? { web: tab('web', 'Search the web', icon.search) } : {}),
      header: tab('header', 'Header', icon.header),
      file: tab('file', 'Attach file', icon.clip),
    };
    const order = Object.keys(tabs);
    const input = h('input', { class: 'pop-input', placeholder: 'Search Wikipedia', autocomplete: 'off', spellcheck: 'false' });
    const langSel = h('select', { class: 'lang', title: 'Language' },
      ...LANGS.map(([code, name]) => h('option', { value: code, selected: code === lang }, `${name}`)));
    const addBtn = h('button', { class: 'btn-green add-header', hidden: true }, 'Add');
    const status = h('div', { class: 'status', hidden: true });
    const list = h('div', { class: 'results' });
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
    const dropText = h('div', { class: 'drop-text' }, 'Drop files here');
    const browseBtn = h('button', { class: 'btn-ghost browse-files' }, 'Browse files');
    const drop = h('div', { class: 'dropzone', hidden: true }, h('span', { class: 'drop-icon' }), dropText, browseBtn);
    drop.firstChild.innerHTML = icon.clip;
    const inputRow = h('div', { class: 'input-row' }, input, langSel, addBtn);
    const m = openModal(h('div', { class: 'picker' },
      h('div', { class: 'tabs', role: 'tablist' }, ...Object.values(tabs)),
      h('div', { class: 'picker-body' }, inputRow, status, list, drop), fileInput));
    m.onClose = (v) => { clearTimeout(timer); window.removeEventListener('online', search); window.removeEventListener('offline', search); resolve(v || null); };
    window.addEventListener('online', search);
    window.addEventListener('offline', search);
    input.focus();

    const setStatus = (text, kind = '') => {
      status.hidden = !text;
      status.textContent = text || '';
      status.className = `status ${kind}`;
    };

    function setMode(next) {
      mode = next;
      for (const [name, b] of Object.entries(tabs)) {
        b.classList.toggle('on', name === mode);
        b.setAttribute('aria-selected', String(name === mode));
      }
      inputRow.hidden = mode === 'file';
      list.hidden = mode === 'file';
      drop.hidden = mode !== 'file';
      dropText.textContent = 'Drop files here';
      drop.classList.remove('bad');
      langSel.hidden = mode !== 'wiki';
      addBtn.hidden = mode !== 'header';
      input.placeholder = { wiki: 'Search Wikipedia', web: 'Search the web or paste a link', header: 'Header' }[mode] || '';
      results = [];
      paint();
      setStatus('');
      if (mode === 'wiki' || mode === 'web') search();
      if (mode === 'file') drop.focus(); else input.focus();
    }
    for (const [name, b] of Object.entries(tabs)) b.onclick = () => setMode(name);
    setMode('wiki');

    // ---------- files: browse or drop only in the paperclip section ----------
    async function takeFiles(fileList) {
      if (m.box.classList.contains('busy')) return;
      const all = [...(fileList || [])];
      const bad = all.filter((f) => f.size > MAX_FILE_SIZE);
      if (!all.length || bad.length) {
        if (mode !== 'file') setMode('file');
        drop.classList.add('bad');
        dropText.textContent = bad.length ? `Larger than 2 GB: ${bad.map((f) => f.name).join(', ')}` : 'Drop files here';
        return;
      }
      m.box.classList.add('busy');
      try {
        if (!m.box.isConnected) return;
        const paths = all.map((f) => api.pathForFile(f)).filter(Boolean);
        if (paths.length !== all.length) throw new Error('Could not read selected files');
        m.close({ type: 'file', paths });
      } catch (e) {
        drop.classList.add('bad');
        dropText.textContent = e.message;
        fileInput.value = '';
      } finally { m.box.classList.remove('busy'); }
    }
    browseBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => takeFiles(fileInput.files);
    drop.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove('over');
      takeFiles(e.dataTransfer?.files);
    });

    function resultIcon(res) {
      if (mode === 'web') {
        const ph = h('div', { class: 'ph web' });
        ph.innerHTML = icon.globe;
        if (!res.icon) return ph;
        const img = h('img', { class: 'favicon', src: res.icon, alt: '' });
        img.onerror = () => img.replaceWith(ph);
        return img;
      }
      return res.thumb ? h('img', { src: res.thumb, alt: '' }) : h('div', { class: 'ph' }, 'W');
    }
    function paint() {
      list.replaceChildren(...results.map((res, i) => h('button', {
        class: `result${i === sel ? ' sel' : ''}${mode === 'web' ? ' web-result' : ''}`, onclick: () => pick(res), onmousemove: () => { if (sel !== i) { sel = i; paint(); } },
      },
      resultIcon(res),
      h('div', { class: 'txt' },
        h('div', { class: 'title' }, res.title),
        mode === 'web' ? h('div', { class: 'url' }, res.direct ? res.url : hostOf(res.url)) : null,
        (mode === 'web' ? res.snippet : res.description) ? h('div', { class: 'desc' }, mode === 'web' ? res.snippet : res.description) : null))));
    }

    async function search() {
      if (mode !== 'wiki' && mode !== 'web') return;
      const q = input.value.trim();
      const my = ++seq;
      const direct = mode === 'web' ? asWebUrl(q) : null;
      if (direct) {
        // A link goes straight to its page; no search needed.
        results = [{ direct: true, url: direct, title: `Open ${hostOf(direct)}` }];
        sel = 0; paint(); setStatus('');
        return;
      }
      if (!navigator.onLine) { results = []; paint(); setStatus('No internet connection', 'offline'); return; }
      if (!q) { results = []; paint(); setStatus(''); return; }
      if (mode === 'web') setStatus('Searching…');
      try {
        const res = mode === 'web' ? await api.webSearch(q) : await api.search(q, lang);
        if (my !== seq) return;
        results = res;
        sel = 0;
        paint();
        setStatus(res.length ? '' : 'No results');
      } catch (e) {
        if (my !== seq) return;
        results = [];
        paint();
        setStatus(isOffline(e) ? 'No internet connection' : e.message, isOffline(e) ? 'offline' : '');
      }
    }

    async function pick(res) {
      if (m.box.classList.contains('busy')) return;
      m.box.classList.add('busy');
      try {
        if (mode === 'web') {
          if (!res.direct) { m.close({ type: 'web', url: res.url, title: res.title.slice(0, 300) }); return; }
          setStatus('Opening…');
          const page = await api.webInfo(res.url).catch(() => ({ url: res.url, title: hostOf(res.url) }));
          m.close({ type: 'web', url: page.url, title: page.title.slice(0, 300) });
          return;
        }
        const s = await cachedSummary(res.title, lang);
        m.close({ type: 'wiki', title: s.title, lang, description: s.description, thumb: s.thumb });
      } catch (e) {
        m.box.classList.remove('busy');
        setStatus(isOffline(e) ? 'No internet connection' : e.message, isOffline(e) ? 'offline' : '');
      }
    }

    function addHeader() {
      const v = input.value.trim();
      if (v) m.close({ type: 'header', title: v.slice(0, 300) });
    }
    addBtn.onclick = addHeader;

    langSel.onchange = () => { lang = langSel.value; setLang(lang); search(); input.focus(); };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, mode === 'web' ? 350 : 180);
    });
    // Pasting a link in the web section opens it straight away.
    input.addEventListener('paste', (e) => {
      if (mode !== 'web') return;
      const url = asWebUrl(e.clipboardData?.getData('text'));
      if (!url) return;
      e.preventDefault();
      input.value = url;
      clearTimeout(timer);
      pick({ direct: true, url, title: hostOf(url) });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); setMode(order[(order.indexOf(mode) + (e.shiftKey ? order.length - 1 : 1)) % order.length]); return; }
      if ((mode === 'wiki' || mode === 'web') && results.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        paint();
        list.children[sel]?.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'header') addHeader();
        else if (mode === 'web' && asWebUrl(input.value)) { clearTimeout(timer); pick({ direct: true, url: asWebUrl(input.value) }); }
        else if (results[sel]) pick(results[sel]);
      }
    });
    if (!navigator.onLine) setStatus('No internet connection', 'offline');
  });
}
