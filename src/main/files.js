// Files attached to a project (images, GIFs, video, audio, PDFs, text). Each one is copied into
// projects/<id>/files/ so the project keeps working if the original moves, and offline.
import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { filesDir, projectFile, newId, validId } from './paths.js';
import { historyText } from './history.js';
import { fileType, opaqueType, MAX_FILE_SIZE, validateText, validatePdf } from '../renderer/lib/file-types.js';

const importSources = new Map(); // one-use, unguessable URLs; never exposes arbitrary paths

/** Copies a file into the project. Returns the node data for it. */
export async function importFile({ projectId, path: src }, validate) {
  if (!validId(projectId)) throw new Error('Invalid project');
  let type = fileType(src) || opaqueType(src);
  const { mime } = type;
  const st = await fsp.stat(src).catch(() => null);
  if (!st?.isFile()) throw new Error(`Can't read ${path.basename(src)}`);
  if (st.size > MAX_FILE_SIZE) throw new Error(`${path.basename(src)} is larger than 2 GB`);
  try {
    if (['text','code','markdown'].includes(type.kind)) await validateText(fs.createReadStream(src));
    else if (type.kind === 'pdf') {
      const handle = await fsp.open(src, 'r');
      try {
        const first = Buffer.alloc(Math.min(8,st.size)), last = Buffer.alloc(Math.min(1024,st.size));
        await handle.read(first,0,first.length,0);
        await handle.read(last,0,last.length,st.size-last.length);
        validatePdf(first,last);
      } finally { await handle.close(); }
    } else if (type.kind !== 'unsupported' && validate) {
      const token = randomBytes(16).toString('hex');
      importSources.set(token,{ src,mime });
      try { await validate({ url: `wikitree://import/${token}`, kind: type.kind }); }
      finally { importSources.delete(token); }
    }
  } catch { type = opaqueType(src); }
  const {ext:e,kind,language} = type;
  await fsp.mkdir(filesDir(projectId), { recursive: true });
  const file = `${newId()}.${e}`;
  await fsp.copyFile(src, path.join(filesDir(projectId), file));
  const name = path.basename(src).slice(0,300);
  return { type: 'file', kind, file, name, ...(language?{language}:{}), title: ['unsupported','code'].includes(kind)?name:path.basename(src,path.extname(src)).slice(0,300)||file, size: st.size };
}

/** Removes copied files that no node in the project refers to any more. */
export async function collectFiles(projectId) {
  if (!validId(projectId)) throw new Error('Invalid project');
  const dir = filesDir(projectId);
  const files = await fsp.readdir(dir).catch(() => []);
  if (!files.length) return;
  let used;
  try {
    const p = JSON.parse(await fsp.readFile(projectFile(projectId), 'utf8'));
    used = new Set(Object.values(p.nodes).filter((n) => n.type === 'file').map((n) => n.file));
  } catch { return; } // can't read the project — delete nothing
  const history = historyText(projectId); // files of deleted nodes stay restorable
  await Promise.all(files.filter((f) => !used.has(f) && !history.includes(`"${f}"`)).map((f) => fsp.rm(path.join(dir, f), { force: true })));
}

/** Serves a project file, with HTTP range support so video and audio can seek and loop. */
export async function serveProjectFile(projectId, name, request) {
  if (!validId(projectId) || !/^[a-f0-9]+\.[a-z0-9]+$/i.test(name)) return new Response('Not found', { status: 404 });
  const file = path.join(filesDir(projectId), name);
  return serveSource(file, fileType(name)?.mime || 'application/octet-stream', request);
}

export function serveImportFile(token, request) {
  const source = importSources.get(token);
  return source ? serveSource(source.src, source.mime, request) : new Response('Not found',{status:404});
}

async function serveSource(file, type, request) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st?.isFile()) return new Response('Not found', { status: 404 });

  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'content-type': type,
        'access-control-allow-origin': '*',
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
  });
}
