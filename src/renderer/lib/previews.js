// Live previews shown both in the tree overview and in the enlarged view. Everything is read-only:
// attachments are never executed, and web pages run in their own sandboxed frame.
import { h, icon } from './dom.js';
import { mountFileInspector } from './file-inspect.js';
import { renderWord } from './word.js';
import { marked } from '../assets/vendor/marked.esm.js';
import { isWebUrl } from './api.js';

// Pages may run scripts, submit forms, open links in the system browser and go fullscreen;
// they may not navigate the app itself or reach it (it is a different origin).
const WEB_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation';
const WEB_ALLOW = 'fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture';

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); } };

export function webFrame(url, title) {
  if (!isWebUrl(url)) return h('p', { class: 'document-error' }, 'Only http and https pages can be shown');
  return h('iframe', { class: 'web-frame', src: url, title: title || hostOf(url), sandbox: WEB_SANDBOX, allow: WEB_ALLOW, allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
}

export function renderMarkdown(container, text, title) {
  const rendered = marked.parse(text.replace(/<(?=\/?[a-z])/gi, '&lt;'), { async: false });
  const template = document.createElement('template');
  template.innerHTML = rendered;
  template.content.querySelectorAll('a').forEach((a) => a.removeAttribute('href'));
  container.replaceChildren(h('article', { class: 'article markdown-article' }, title ? h('h1', {}, title) : null, template.content));
}

/** Fills `body` with the node's live content; returns a cleanup function. */
export function mountPreview(body, n, src) {
  let disposed = false;
  let dispose = () => {};
  const fail = (e) => { if (!disposed) body.replaceChildren(h('p', { class: 'document-error' }, e.message)); };
  const kind = n.type === 'web' ? 'web' : n.kind;
  body.dataset.kind = kind;
  if (kind === 'web') body.append(webFrame(n.url, n.title));
  else if (kind === 'pdf') body.append(h('iframe', { class: 'pdf-frame', src: `${src}#view=FitH`, title: n.title }));
  else if (kind === 'video') body.append(h('video', { class: 'video-player', src, controls: true, preload: 'metadata', playsinline: true }));
  else if (kind === 'audio') {
    const glyph = h('span', { class: 'file-glyph' });
    glyph.innerHTML = icon.audio;
    body.append(glyph, h('audio', { class: 'audio-player', src, controls: true, preload: 'metadata' }));
  } else if (kind === 'image') body.append(h('img', { class: 'media-image', src, alt: n.name || n.title }));
  else if (kind === 'word') {
    const pages = h('div', { class: 'document-content word' });
    body.append(pages);
    fetch(src).then((r) => { if (!r.ok) throw new Error('Could not read document'); return r.blob(); })
      .then((blob) => !disposed && renderWord(pages, blob)).catch(fail);
  } else if (kind === 'markdown') {
    const doc = h('div', { class: 'document-content markdown' });
    body.append(doc);
    fetch(src).then((r) => { if (!r.ok) throw new Error('Could not read document'); return r.text(); })
      .then((text) => !disposed && renderMarkdown(doc, text)).catch(fail);
  } else {
    const doc = h('div', { class: 'document-content' });
    body.append(doc);
    dispose = mountFileInspector(doc, n, src);
  }
  return () => {
    disposed = true;
    dispose();
    body.querySelectorAll('audio,video').forEach((media) => { media.pause(); media.removeAttribute('src'); media.load(); });
    if (document.fullscreenElement && body.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
  };
}

/** The element that should fill the screen for this preview. */
export const fullscreenTarget = (body) => body.querySelector(':scope > .web-frame, :scope > .pdf-frame, :scope > .video-player, :scope > .media-image') || body;

export async function toggleFullscreen(el) {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (el.requestFullscreen) return el.requestFullscreen();
  el.webkitEnterFullscreen?.(); // iOS video
}
