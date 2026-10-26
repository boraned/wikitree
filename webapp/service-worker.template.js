const DB_NAME = 'wikitree-ios';
const STATIC_CACHE = 'wikitree-shell-v1';
const STATIC_URLS = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('wikitree-shell-') && key !== STATIC_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readBlob(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
function rangeResponse(record, request) {
  const blob = record.blob;
  const type = record.mime || blob.type || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const common = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (!range || (!range[1] && !range[2])) return new Response(blob, { headers: { ...common, 'content-length': String(blob.size) } });
  const start = range[1] ? Number(range[1]) : Math.max(0, blob.size - Number(range[2]));
  const end = Math.min(range[2] && range[1] ? Number(range[2]) : blob.size - 1, blob.size - 1);
  if (start > end || start >= blob.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${blob.size}` } });
  const part = blob.slice(start, end + 1);
  return new Response(part, { status: 206, headers: { ...common, 'content-length': String(part.size), 'content-range': `bytes ${start}-${end}/${blob.size}` } });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Never cache Wikipedia article responses.
  const scopePath = new URL(self.registration.scope).pathname;
  const relative = decodeURIComponent(url.pathname.slice(scopePath.length));
  const match = /^(__(?:file|media))\/([a-f0-9]{6,32})\/([a-f0-9]+\.[a-z0-9]+)$/i.exec(relative);
  if (match) {
    event.respondWith((async () => {
      const store = match[1] === '__file' ? 'files' : 'media';
      const record = await readBlob(store, `${match[2]}:${match[3]}`);
      return record ? rangeResponse(record, request) : new Response('File not found', { status: 404 });
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetch(request);
  })());
});
