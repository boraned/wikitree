// Centered in-app dialogs: confirm and the Wiki/Header picker.
import { api, LANGS, getLang, setLang, isOffline, cachedSummary } from './api.js';
import { h } from './dom.js';

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

/**
 * Lets the user choose a Wikipedia article or type a header.
 * Resolves { type:'wiki', title, lang, description, thumb } | { type:'header', title } | null.
 */
export function pickNode() {
  return new Promise((resolve) => {
    let mode = 'wiki';
    let lang = getLang();
    let results = [];
    let sel = 0;
    let seq = 0;
    let timer = null;

    const tabWiki = h('button', { class: 'tab on' }, 'Wikipedia');
    const tabHeader = h('button', { class: 'tab' }, 'Header');
    const input = h('input', { class: 'pop-input', placeholder: 'Search Wikipedia', autocomplete: 'off', spellcheck: 'false' });
    const langSel = h('select', { class: 'lang', title: 'Language' },
      ...LANGS.map(([code, name]) => h('option', { value: code, selected: code === lang }, `${name}`)));
    const addBtn = h('button', { class: 'btn-green add-header', hidden: true }, 'Add');
    const status = h('div', { class: 'status', hidden: true });
    const list = h('div', { class: 'results' });
    const m = openModal(h('div', { class: 'picker' },
      h('div', { class: 'tabs' }, tabWiki, tabHeader),
      h('div', { class: 'input-row' }, input, langSel, addBtn),
      status, list));
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
      tabWiki.classList.toggle('on', mode === 'wiki');
      tabHeader.classList.toggle('on', mode === 'header');
      langSel.hidden = mode !== 'wiki';
      addBtn.hidden = mode !== 'header';
      input.placeholder = mode === 'wiki' ? 'Search Wikipedia' : 'Header';
      results = [];
      paint();
      setStatus('');
      if (mode === 'wiki') search();
      input.focus();
    }
    tabWiki.onclick = () => setMode('wiki');
    tabHeader.onclick = () => setMode('header');

    function paint() {
      list.replaceChildren(...results.map((res, i) => h('button', {
        class: `result${i === sel ? ' sel' : ''}`, onclick: () => pick(res), onmousemove: () => { if (sel !== i) { sel = i; paint(); } },
      },
      res.thumb ? h('img', { src: res.thumb, alt: '' }) : h('div', { class: 'ph' }, 'W'),
      h('div', { class: 'txt' }, h('div', { class: 'title' }, res.title), res.description ? h('div', { class: 'desc' }, res.description) : null))));
    }

    async function search() {
      if (mode !== 'wiki') return;
      const q = input.value.trim();
      const my = ++seq;
      if (!navigator.onLine) { results = []; paint(); setStatus('No internet connection', 'offline'); return; }
      if (!q) { results = []; paint(); setStatus(''); return; }
      try {
        const res = await api.search(q, lang);
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
        if (mode === 'header') addHeader();
        else if (results[sel]) pick(results[sel]);
      }
    });
    if (!navigator.onLine) setStatus('No internet connection', 'offline');
  });
}
