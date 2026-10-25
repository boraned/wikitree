// Turns Parsoid HTML from Wikipedia into a clean, dark-friendly article (any language).
const JUNK = [
  'script', 'style', 'link', 'meta', 'noscript',
  '.mw-editsection', '.navbox', '.navbox-styles', '.vertical-navbox', '.sidebar', '.ambox', '.ombox', '.tmbox',
  '.mbox-small', '.metadata', '.sistersitebox', '.side-box', '.portalbox', '.hatnote', '.dablink',
  '.shortdescription', '.noprint', '.mw-empty-elt', '.reflist', '.refbegin', '.mw-references-wrap', 'ol.references',
  'sup.reference', 'sup.mw-ref', '.mw-ref', '.reference', '.catlinks', '[role="navigation"]',
  '.authority-control', '.stub', '.asbox', '.mw-indicators', '.mw-kartographer-maplink', '.ext-phonos',
];
const JUNK_SECTIONS = /^(see also|notes|references|sources|external links|further reading|bibliography|citations|footnotes|notes and references|references and notes|works cited|explanatory notes|general and cited sources|general sources|cited sources|primary sources|secondary sources|other sources|literature|selected bibliography|gallery)$/i;
// "See also / References / External links / Further reading" in every language the picker offers.
const APPENDIX = new Set(`
ayrıca bakınız|kaynakça|kaynaklar|dış bağlantılar|notlar|dipnotlar|ileri okumalar|konuyla ilgili yayınlar
siehe auch|literatur|weblinks|einzelnachweise|anmerkungen|quellen|weiterführende literatur
voir aussi|notes et références|références|liens externes|bibliographie|articles connexes
véase también|referencias|enlaces externos|bibliografía|notas|lecturas adicionales
voci correlate|note|bibliografia|collegamenti esterni|altri progetti
ver também|referências|ligações externas|leitura adicional
zie ook|externe links|bronnen|referenties|noten|literatuur|bronnen, noten en/of referenties
zobacz też|przypisy|linki zewnętrzne
se även|referenser|externa länkar|källor|noter|vidare läsning
se også|referanser|eksterne lenker|kilder|litteratur|eksterne henvisninger|referencer
katso myös|lähteet|aiheesta muualla|viitteet|kirjallisuutta
odkazy|reference|související články|externí odkazy|literatura|poznámky
kapcsolódó szócikkek|források|jegyzetek|további információk|irodalom
vezi și|bibliografie|legături externe|referințe
δείτε επίσης|παραπομπές|εξωτερικοί σύνδεσμοι|βιβλιογραφία|σημειώσεις
см. также|примечания|литература|ссылки|источники
див. також|примітки|джерела|посилання|література
həmçinin bax|istinadlar|xarici keçidlər|ədəbiyyat|qeydlər|mənbə|mənbələr
انظر أيضا|انظر أيضًا|مراجع|المراجع|وصلات خارجية|روابط خارجية|ملاحظات|مصادر|المصادر
جستارهای وابسته|منابع|پیوند به بیرون|یادداشت‌ها|پانویس
ראו גם|הערות שוליים|קישורים חיצוניים|לקריאה נוספת|מקורות
इन्हें भी देखें|सन्दर्भ|संदर्भ|बाहरी कड़ियाँ
lihat pula|referensi|pranala luar|catatan|bacaan lanjutan|daftar pustaka
xem thêm|tham khảo|liên kết ngoài|chú thích|ghi chú
関連項目|脚注|参考文献|外部リンク|出典|注釈
參見|参见|参考文献|參考文獻|外部链接|外部連結|注释|註釋|延伸阅读|延伸閱讀
같이 보기|각주|참고 문헌|외부 링크|참고 자료
vegeu també|referències|enllaços externs|notes`.split(/[|\n]/).map((s) => s.trim()).filter(Boolean));
const isAppendix = (text) => {
  const t = text.trim().toLowerCase();
  return JUNK_SECTIONS.test(t) || APPENDIX.has(t);
};
const FALLBACK_NS = ['file', 'image', 'media', 'category', 'help', 'special', 'wikipedia', 'wp', 'template', 'talk', 'portal', 'user', 'module', 'draft', 'mediawiki', 'timedtext'];

const heading = (sec) => sec.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > .mw-heading > h2, :scope > .mw-heading > h3');
const textLen = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;

export function cleanArticle(html, namespaces = []) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  const ns = new Set([...FALLBACK_NS, ...namespaces]);
  const isNonArticle = (title) => {
    const i = title.indexOf(':');
    return i > 0 && ns.has(title.slice(0, i).toLowerCase());
  };

  // Reference / external-link sections, detected by content so it works in every language.
  d.querySelectorAll('.mw-references-wrap, .reflist, .refbegin, ol.references').forEach((r) => {
    const sec = r.closest('section');
    if (sec && heading(sec)) sec.remove();
  });
  d.querySelectorAll('section').forEach((sec) => {
    const hd = heading(sec);
    if (!hd) return;
    if (isAppendix(hd.textContent)) { sec.remove(); return; }
    const links = [...sec.querySelectorAll('a[href]')];
    const ext = links.filter((a) => (a.getAttribute('rel') || '').includes('mw:ExtLink')).length;
    const loose = textLen(sec) - textLen(hd) - links.reduce((s, a) => s + textLen(a), 0);
    if (links.length && ext / links.length >= 0.7 && loose < 300) sec.remove();
  });
  // Trailing appendix sections ("See also", "External links" in any language): pure link lists or mostly external links.
  const top = [...d.body.querySelectorAll(':scope > section')];
  for (let i = top.length - 1; i > 0; i--) {
    const sec = top[i];
    const hd = heading(sec);
    if (!hd) break;
    const links = [...sec.querySelectorAll('a[href]')];
    const ext = links.filter((a) => (a.getAttribute('rel') || '').includes('mw:ExtLink')).length;
    const items = [...sec.querySelectorAll('li')];
    const loose = textLen(sec) - textLen(hd) - links.reduce((s, a) => s + textLen(a), 0);
    const linkList = items.length >= 2 && !sec.querySelector('p, table')
      && items.every((li) => { const a = li.querySelector('a'); return a && textLen(li) - textLen(a) < 25; });
    const extList = links.length && ext / links.length >= 0.5 && loose < 400;
    if (linkList || extList) sec.remove(); else break;
  }

  d.querySelectorAll(JUNK.join(',')).forEach((el) => el.remove());
  // Headings whose section ended up empty.
  d.querySelectorAll('section').forEach((sec) => {
    const hd = heading(sec);
    if (hd && textLen(sec) - textLen(hd) === 0 && !sec.querySelector('img, table')) sec.remove();
  });

  // Absolute media URLs.
  const abs = (u) => u.replace(/(^|,\s*)\/\//g, '$1https://');
  d.querySelectorAll('img, video, audio, source').forEach((el) => {
    for (const a of ['src', 'srcset', 'poster', 'resource']) if (el.getAttribute(a)) el.setAttribute(a, abs(el.getAttribute(a)));
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy');
      if (/\.(svg|png|gif)/i.test(el.getAttribute('src') || '')) el.classList.add('tr');
    }
  });

  // Links: wiki links become in-app links, everything else is unwrapped or opened externally.
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
      let title;
      try { title = decodeURIComponent(raw.split('?')[0]).replace(/_/g, ' '); } catch { title = raw; }
      if (a.classList.contains('new') || isNonArticle(title) || href.includes('redlink=1')) {
        a.replaceWith(...a.childNodes);
      } else {
        a.className = 'wl';
        a.dataset.title = title;
        if (frag) { try { a.dataset.frag = decodeURIComponent(frag); } catch { /* ignore */ } }
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
  d.querySelectorAll('[data-mw], [about]').forEach((el) => {
    el.removeAttribute('data-mw');
    el.removeAttribute('about');
  });

  return { html: d.body.innerHTML, dir: d.body.getAttribute('dir') || 'ltr', lang: d.body.getAttribute('lang') || '' };
}

/** Offline copy: one (sharpest) file per image; returns the HTML and the image URLs to download. */
export function prepareForSaving(html) {
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const images = new Set();
  d.querySelectorAll('img').forEach((img) => {
    const set = img.getAttribute('srcset');
    if (set) {
      const best = set.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (best) img.setAttribute('src', best);
      img.removeAttribute('srcset');
    }
    const src = img.getAttribute('src');
    if (src && /^https:\/\//.test(src)) images.add(src);
  });
  d.querySelectorAll('source').forEach((s) => s.removeAttribute('srcset'));
  return { html: d.body.innerHTML, images: [...images] };
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

/** Fetches, cleans and stores one article for offline reading. */
export async function saveOffline(api, projectId, node) {
  const page = await api.page(node.title, node.lang, projectId);
  let cleanHtml = page.html;
  let dir = page.dir || 'ltr';
  if (!page.cleaned) {
    const ns = await api.namespaces(node.lang).catch(() => []);
    ({ html: cleanHtml, dir } = cleanArticle(page.html, ns));
  }
  const { html, images } = prepareForSaving(cleanHtml);
  const r = await api.savePage({ projectId, lang: node.lang, title: page.title, html, images, thumb: node.thumb || null, dir });
  return { ...r, title: page.title };
}
