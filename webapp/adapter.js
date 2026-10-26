// Browser/PWA implementation of the same API exposed by Electron's preload bridge.
// Projects, attachments and explicit offline downloads live in IndexedDB; transient article HTML stays in RAM.
import { diffProjects, applyDelta, needsSnapshot } from './lib/history-core.js';
import { validatePickedFile } from './lib/file-validation.js';

const DB_NAME = 'wikitree-ios';
const DB_VERSION = 2;
const STORE_NAMES = ['projects', 'files', 'pages', 'media', 'history', 'historyMeta'];

const articleMemory = new Map();
const historyBaselines = new Map();
let database;

const fail = (message) => { throw new Error(message); };
const newId = () => crypto.getRandomValues(new Uint8Array(6)).reduce((s, x) => s + x.toString(16).padStart(2, '0'), '');
const validId = (id) => /^[a-z0-9]{6,32}$/.test(id || '');
const titleKey = (title) => String(title).trim().replaceAll(' ', '_');
const pageKey = (lang, title) => `${lang}:${titleKey(title)}`;
const recordKey = (projectId, key) => `${projectId}:${key}`;
const fileUrl = (projectId, file) => `./__file/${projectId}/${encodeURIComponent(file)}`;
const mediaUrl = (projectId, file) => `./__media/${projectId}/${encodeURIComponent(file)}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other WikiTree tabs and reload.'));
  });
}

function run(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    let result;
    try { result = action(tx.objectStore(storeName)); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error || result?.error);
    tx.onabort = () => reject(tx.error || new Error('Local storage failed'));
  });
}
const get = (store, key) => new Promise((resolve, reject) => {
  const tx = database.transaction(store, 'readonly');
  const req = tx.objectStore(store).get(key);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const getAll = (store) => new Promise((resolve, reject) => {
  const tx = database.transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll();
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const put = (store, value) => run(store, 'readwrite', (s) => s.put(value)).catch((e) => {
  if (e?.name === 'QuotaExceededError') throw new Error('Not enough free storage on this iPad. Remove some downloads or files and try again.');
  throw e;
});
const remove = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

function pageRecordKey(projectId, lang, title) { return recordKey(projectId, pageKey(lang, title)); }

async function importOne(projectId, file) {
  if (!validId(projectId)) fail('Invalid project');
  if (!(file instanceof Blob)) fail('Choose a file from Files.');
  const { ext, kind, mime, language } = await validatePickedFile(file);
  const name = `${newId()}.${ext}`;
  await put('files', { key: recordKey(projectId, name), projectId, file: name, mime, blob: file });
  return { type: 'file', kind, file: name, name:file.name.slice(0,300), ...(language?{language}:{}), title: ['unsupported','code'].includes(kind)?file.name.slice(0,300):file.name.replace(/\.[^.]+$/, '').slice(0, 300)||name, size: file.size };
}

async function createProject(root) {
  const id = newId();
  const now = Date.now();
  const rootId = newId();
  let rootNode;
  const nodes = {};
  if (root?.type === 'file') {
    const paths = root.paths || [];
    if (!paths.length) fail('Choose a file first.');
    const first = await importOne(id, paths[0]);
    rootNode = { id: rootId, ...first, parent: null, children: [], x: 0, y: 0 };
    nodes[rootId] = rootNode;
    for (const file of paths.slice(1)) {
      try {
        const data = await importOne(id, file);
        const nodeId = newId();
        nodes[nodeId] = { id: nodeId, ...data, parent: rootId, children: [] };
        rootNode.children.push(nodeId);
      } catch { /* keep successfully imported files */ }
    }
  } else {
    const type = root?.type === 'wiki' ? 'wiki' : 'header';
    const title = String(root?.title || '').trim().slice(0, 300);
    if (!title) fail('Title required');
    rootNode = { id: rootId, type, title, parent: null, children: [], x: 0, y: 0 };
    if (type === 'wiki') Object.assign(rootNode, { lang: root.lang || 'en', description: root.description || '', thumb: root.thumb || null });
    nodes[rootId] = rootNode;
  }
  const project = { id, title: rootNode.title, created: now, updated: now, rootId, roots: [rootId], nodes };
  await put('projects', { key: id, ...project });
  await seedHistory(project);
  return project;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const historyKey = (projectId, seq) => `${projectId}:${String(seq).padStart(10, '0')}`;
async function seedHistory(project) {
  const initial = clone(project);
  const entry = { key: historyKey(project.id, 1), projectId: project.id, seq: 1, at: project.created, summary: 'Project created', snapshot: initial, changes: null };
  await put('history', entry);
  await put('historyMeta', { key: project.id, projectId: project.id, seq: 1 });
  rememberHistoryBaseline(project.id, initial);
}

/** Stores one delta; a full snapshot is added once the deltas since the last one outweigh the project. */
async function appendHistory(projectId, meta, current, changes, at, summary) {
  const seq = (meta?.seq || 1) + 1;
  const entry = { key: historyKey(projectId, seq), projectId, seq, at, summary, changes };
  const bytesSince = (meta?.bytesSince || 0) + JSON.stringify(changes).length;
  const snapshot = needsSnapshot(bytesSince, JSON.stringify(current).length);
  if (snapshot) entry.snapshot = clone(current);
  await put('history', entry);
  await put('historyMeta', { key: projectId, projectId, seq, bytesSince: snapshot ? 0 : bytesSince });
}

function rememberHistoryBaseline(projectId, value) {
  historyBaselines.delete(projectId);
  historyBaselines.set(projectId, value);
  while (historyBaselines.size > 2) historyBaselines.delete(historyBaselines.keys().next().value);
}
async function historyBaseline(projectId, meta) {
  if (historyBaselines.has(projectId)) return historyBaselines.get(projectId);
  if (meta?.latest) { const copy = clone(meta.latest); rememberHistoryBaseline(projectId, copy); return copy; }
  if (meta?.seq) { const copy = await historySnapshot(projectId, meta.seq); rememberHistoryBaseline(projectId, copy); return copy; }
  const current = await project(projectId);
  await seedHistory(current);
  return historyBaselines.get(projectId);
}

async function page(titleOrRequest, language = 'en', requestedProjectId) {
  const { title, lang = 'en', projectId } = typeof titleOrRequest === 'object'
    ? titleOrRequest
    : { title: titleOrRequest, lang: language, projectId: requestedProjectId };
  const saved = validId(projectId) ? await get('pages', pageRecordKey(projectId, lang, title)) : null;
  if (saved) return { ...saved.page, saved: true };
  const key = `${lang}:${titleKey(title).toLowerCase()}`;
  if (articleMemory.has(key)) return articleMemory.get(key);
  try {
    const res = await fetch(`https://${lang}.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(titleKey(title))}/html`);
    if (!res.ok) fail(res.status === 404 ? 'No such page' : `Wikipedia returned ${res.status}`);
    const html = await res.text();
    const canonical = html.match(/<link rel="dc:isVersionOf" href="[^"]*\/wiki\/([^"]+)"/);
    const result = { title: canonical ? decodeURIComponent(canonical[1]).replaceAll('_', ' ') : title, lang, html };
    articleMemory.set(key, result);
    return result;
  } catch (e) { throw new Error(navigator.onLine ? e.message : 'No internet connection'); }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
async function savePage({ projectId, lang, title, html, images = [], thumb, dir }) {
  const map = new Map();
  let failed = 0;
  for (const url of [...new Set([...images, thumb].filter(Boolean))]) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const ext = new URL(url, location.href).pathname.match(/\.(jpe?g|png|gif|svg|webp|avif)$/i)?.[1]?.toLowerCase() || 'img';
      const file = `${await digest(url)}.${ext}`;
      await put('media', { key: recordKey(projectId, file), projectId, file, mime: blob.type || mimeFor(ext), blob });
      map.set(url, mediaUrl(projectId, file));
    } catch { failed++; }
  }
  let content = String(html);
  for (const [url, local] of map) content = content.split(url).join(local).split(url.replace(/&/g, '&amp;')).join(local);
  const value = { title, lang, dir: dir === 'rtl' ? 'rtl' : 'ltr', html: content, cleaned: true, savedAt: Date.now() };
  await put('pages', { key: pageRecordKey(projectId, lang, title), projectId, lang, title, page: value });
  return { thumbLocal: thumb && map.get(thumb) || null, failed };
}

async function collectMedia(projectId) {
  const keep = new Set();
  const linkPattern = new RegExp(`__media/${projectId}/([a-f0-9]+\\.[a-z0-9]+)`, 'gi');
  const scan = (text) => { for (const match of String(text).matchAll(linkPattern)) keep.add(match[1]); };
  for (const record of (await getAll('pages')).filter((row) => row.projectId === projectId)) scan(record.page.html);
  const current = await get('projects', projectId);
  if (current) for (const node of Object.values(current.nodes)) if (node.thumbLocal) scan(node.thumbLocal);
  for (const entry of (await getAll('history')).filter((row) => row.projectId === projectId)) {
    for (const node of Object.values(entry.snapshot?.nodes || {})) if (node.thumbLocal) scan(node.thumbLocal);
    for (const node of Object.values(entry.changes?.nodes || {})) {
      scan(node.thumbLocal || '');
      scan(node.fields?.thumbLocal || '');
    }
  }
  const all = (await getAll('media')).filter((row) => row.projectId === projectId && !keep.has(row.file));
  if (all.length) await run('media', 'readwrite', (s) => all.forEach((row) => s.delete(row.key)));
}

async function saveProject(project) {
  if (!validId(project?.id) || !project.nodes?.[project.rootId] || project.nodes[project.rootId].parent != null) fail('Invalid project');
  project.updated = Date.now();
  project.title = project.nodes[project.rootId].title;
  let previous = await get('historyMeta', project.id);
  const baseline = await historyBaseline(project.id, previous);
  const current = clone(project);
  previous = await get('historyMeta', project.id);
  const changes = diffProjects(baseline, current);
  await put('projects', { key: project.id, ...project });
  if (changes) await appendHistory(project.id, previous, current, changes, project.updated, changes.summary);
  rememberHistoryBaseline(project.id, current);
  localStorage.removeItem(`wikitree-pending-${project.id}`);
  return { updated: project.updated };
}
async function projects() {
  const all = (await getAll('projects')).sort((a, b) => b.updated - a.updated);
  return all.map((p) => ({ id: p.id, title: p.label || p.title, updated: p.updated, count: Object.keys(p.nodes).length,
    thumbs: Array.isArray(p.cover) && p.cover.length ? p.cover.slice(0, 6)
      : Object.values(p.nodes).map((n) => n.type === 'wiki' ? n.thumbLocal || n.thumb : n.type === 'file' && n.kind === 'image' ? fileUrl(p.id, n.file) : null).filter(Boolean).slice(0, 4) }));
}
async function project(id) {
  const pending = localStorage.getItem(`wikitree-pending-${id}`);
  if (pending) return JSON.parse(pending);
  const p = await get('projects', id);
  if (!p) fail('Project not found');
  const { key, ...clean } = p;
  return clean;
}
async function deleteProject(id) {
  for (const store of STORE_NAMES) {
    if (store === 'projects') { await remove(store, id); continue; }
    const all = await getAll(store);
    const keys = all.filter((r) => r.projectId === id).map((r) => r.key);
    if (keys.length) await run(store, 'readwrite', (s) => keys.forEach((key) => s.delete(key)));
  }
  return { ok: true };
}
async function collectFiles(projectId) {
  const p = await project(projectId);
  const used = new Set(Object.values(p.nodes).filter((n) => n.type === 'file').map((n) => n.file));
  for (const entry of (await getAll('history')).filter((row) => row.projectId === projectId)) {
    for (const node of Object.values(entry.snapshot?.nodes || {})) if (node.type === 'file') used.add(node.file);
    for (const node of Object.values(entry.changes?.nodes || {})) {
      if (node.type === 'file' && node.file) used.add(node.file);
      if (node.fields?.type === 'file' && node.fields.file) used.add(node.fields.file);
      if (node.fields?.file) used.add(node.fields.file);
    }
  }
  const files = (await getAll('files')).filter((f) => f.projectId === projectId && !used.has(f.file));
  if (files.length) await run('files', 'readwrite', (s) => files.forEach((f) => s.delete(f.key)));
}
async function unsavePage({ projectId, lang, title }) {
  await remove('pages', pageRecordKey(projectId, lang, title));
  await collectMedia(projectId);
  return { ok: true };
}
async function savedState(projectId, items) {
  return Promise.all(items.map(async ({ lang, title }) => !!(await get('pages', pageRecordKey(projectId, lang, title)))));
}

async function history(projectId, beforeSeq = Infinity, limit = 100) {
  let all = (await getAll('history')).filter((row) => row.projectId === projectId);
  if (!all.length) { const current = await project(projectId); await seedHistory(current); all = (await getAll('history')).filter((row) => row.projectId === projectId); }
  const entries = all.filter((row) => row.seq < beforeSeq)
    .sort((a, b) => b.seq - a.seq).slice(0, limit);
  const remaining = all.some((row) => row.seq < (entries.at(-1)?.seq ?? beforeSeq));
  return { entries: entries.map(({ seq, at, summary, snapshot }) => ({ seq, at, summary, snapshot: !!snapshot })), hasMore: remaining };
}
async function historySnapshot(projectId, targetSeq) {
  const rows = (await getAll('history')).filter((row) => row.projectId === projectId && row.seq <= targetSeq).sort((a, b) => a.seq - b.seq);
  let project = null;
  let start = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].snapshot) { project = clone(rows[i].snapshot); start = i + 1; break; }
  }
  if (!project) fail('Snapshot not found');
  for (const row of rows.slice(start)) {
    applyDelta(project, row.changes);
    project.updated = row.at;
  }
  return project;
}
async function restoreSnapshot(projectId, seq) {
  const snapshot = await historySnapshot(projectId, seq);
  const old = await get('historyMeta', projectId);
  const previous = await historyBaseline(projectId, old);
  snapshot.updated = Date.now();
  const changes = diffProjects(previous, snapshot);
  await put('projects', { key: projectId, ...snapshot });
  if (changes) await appendHistory(projectId, old, snapshot, changes, snapshot.updated, `Restored snapshot ${seq}`);
  rememberHistoryBaseline(projectId, clone(snapshot));
  localStorage.removeItem(`wikitree-pending-${projectId}`);
  return snapshot;
}

function tarHeader(name, size, mtime) {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();
  const write = (offset, length, text) => header.set(encoder.encode(String(text).slice(0, length)), offset);
  const octal = (offset, length, value) => write(offset, length, `${Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0')}\0`);
  write(0, 100, name);
  octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, size); octal(136, 12, Math.floor(mtime / 1000));
  header.fill(32, 148, 156); header[156] = 48;
  write(257, 6, 'ustar\0'); write(263, 2, '00'); write(265, 32, 'WikiTree');
  let sum = 0;
  for (const byte of header) sum += byte;
  write(148, 6, sum.toString(8).padStart(6, '0'));
  header[154] = 0; header[155] = 32;
  return header;
}
function tarStream(entries) {
  return new ReadableStream({
    async start(controller) {
      try {
        for (const entry of entries) {
          controller.enqueue(tarHeader(entry.name, entry.blob.size, Date.now()));
          const reader = entry.blob.stream().getReader();
          let written = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            written += value.byteLength;
            controller.enqueue(value);
          }
          const pad = (512 - (written % 512)) % 512;
          if (pad) controller.enqueue(new Uint8Array(pad));
        }
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      } catch (e) { controller.error(e); }
    },
  });
}
async function exportProject(projectId) {
  const data = await project(projectId);
  let historyRows = (await getAll('history')).filter((row) => row.projectId === projectId);
  if (!historyRows.length) { await seedHistory(data); historyRows = (await getAll('history')).filter((row) => row.projectId === projectId); }
  historyRows.sort((a, b) => a.seq - b.seq);
  const files = (await getAll('files')).filter((row) => row.projectId === projectId);
  const pages = (await getAll('pages')).filter((row) => row.projectId === projectId);
  const media = (await getAll('media')).filter((row) => row.projectId === projectId);
  const jsonBlob = (value) => new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' });
  const entries = [
    { name: 'project.json', blob: jsonBlob(data) },
    { name: 'history.json', blob: jsonBlob(historyRows) },
  ];
  const manifest = { format: 'WikiTree', archiveVersion: 1, historyFormat: 2, project: 'project.json', history: 'history.json', files: [], pages: [], media: [] };
  for (const row of files) { const name = `files/${row.file}`; manifest.files.push({ path: name, mime: row.mime }); entries.push({ name, blob: row.blob }); }
  for (const row of pages) {
    const name = `pages/${await digest(`${row.lang}:${row.title}`)}.json`;
    manifest.pages.push({ path: name, lang: row.lang, title: row.title });
    entries.push({ name, blob: jsonBlob(row.page) });
  }
  for (const row of media) { const name = `media/${row.file}`; manifest.media.push({ path: name, mime: row.mime }); entries.push({ name, blob: row.blob }); }
  entries.unshift({ name: 'manifest.json', blob: jsonBlob(manifest) });
  if (!('CompressionStream' in globalThis)) fail('This Safari version cannot create compressed .wt files. Update iOS and try again.');
  const stream = tarStream(entries).pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream, { headers: { 'content-type': 'application/vnd.wikitree.project+gzip' } }).blob();
  const slug = data.title.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || projectId;
  return { blob, filename: `WikiTree-${slug}.wt` };
}

function markdownSafe(value) { return String(value).replace(/[\\`*_{}\[\]<>#+.!|]/g, '\\$&').replace(/[\r\n]+/g, ' '); }
async function exportObsidian(projectId) {
  const data = await project(projectId);
  const visited = new Set();
  const lines = [
    '---',
    `wikitree_project: ${JSON.stringify(data.id)}`,
    `exported: ${new Date().toISOString()}`,
    'tags:',
    '  - wikitree',
    '---',
    '',
    `# ${markdownSafe(data.title)}`,
    '',
  ];
  const walk = (id, depth) => {
    const node = data.nodes[id];
    if (!node || visited.has(id)) return;
    visited.add(id);
    const indent = '  '.repeat(depth);
    if (node.type === 'wiki') {
      const lang = node.lang || 'en';
      const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(node.title).trim().replaceAll(' ', '_'))}`;
      lines.push(`${indent}- [${markdownSafe(node.title)}](${url})`);
    } else if (node.type === 'header') lines.push(`${indent}- **${markdownSafe(node.title)}**`);
    else if (node.type === 'file') lines.push(`${indent}- ${markdownSafe(node.title)} _(attached ${markdownSafe(node.kind || 'file')}; included in the .wt archive)_`);
    for (const child of node.children || []) walk(child, depth + 1);
  };
  for (const rootId of data.roots || [data.rootId]) walk(rootId, 0);
  lines.push('', `---`, `Exported from WikiTree. This note is a linked outline; the complete project, files, and revision history are in the .wt export.`, '');
  const slug = data.title.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || projectId;
  return { blob: new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), filename: `WikiTree-${slug}-Obsidian.md` };
}

async function wikiFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) fail(`Wikipedia returned ${res.status}`);
    return res;
  } catch (e) { throw new Error(navigator.onLine ? e.message : 'No internet connection'); }
}

export async function installBrowserApi() {
  database = await openDb();
  navigator.storage?.persist?.().catch(() => {});
  window.wikitree = {
    projects,
    createProject,
    project,
    saveProject,
    saveProjectSync: (p) => { try { localStorage.setItem(`wikitree-pending-${p.id}`, JSON.stringify(p)); } catch { /* IndexedDB autosaves normally */ } },
    deleteProject,
    search: async (q, lang) => {
      const res = await wikiFetch(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      return data.pages.map((p) => ({ title: p.title, description: p.description || '', thumb: p.thumbnail?.url?.startsWith('//') ? `https:${p.thumbnail.url}` : p.thumbnail?.url || null }));
    },
    summary: async (title, lang) => {
      const res = await wikiFetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleKey(title))}`);
      const data = await res.json();
      return { title: data.titles?.canonical?.replaceAll('_', ' ') || data.title, description: data.description || '', extract: data.extract || '', thumb: data.thumbnail?.source || null };
    },
    page,
    namespaces: async (lang) => {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&meta=siteinfo&siprop=namespaces%7Cnamespacealiases&format=json&formatversion=2&origin=*`;
      const res = await wikiFetch(url);
      const data = await res.json();
      const names = new Set();
      for (const ns of Object.values(data.query.namespaces)) if (ns.id !== 0) for (const n of [ns.name, ns.canonical]) if (n) names.add(n.toLowerCase());
      for (const alias of data.query.namespacealiases || []) if (alias.id !== 0) names.add(alias.alias.toLowerCase());
      return [...names];
    },
    savePage,
    unsavePage,
    savedState,
    importFile: async (projectId, file) => importOne(projectId, file),
    collectFiles,
    history,
    historySnapshot,
    restoreSnapshot,
    exportProject,
    exportObsidian,
    pathForFile: (file) => file,
    fileUrl,
    settings: () => { try { return JSON.parse(localStorage.getItem('wikitree-settings') || '{}'); } catch { return {}; } },
    setSetting: async (key, value) => { const s = window.wikitree.settings(); s[key] = value; localStorage.setItem('wikitree-settings', JSON.stringify(s)); },
    openExternal: (url) => { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
  };
}

export { DB_NAME, DB_VERSION, STORE_NAMES, recordKey, mediaUrl };
