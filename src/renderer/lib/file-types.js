// One attachment catalog for main-process validation, the picker and the browser adapter.
import { SOURCE_LANGUAGES } from './source-languages.js';
export const FILE_FORMATS = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp' },
  video: { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' },
  audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg' },
  pdf: { pdf: 'application/pdf' },
  word: {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docm: 'application/vnd.ms-word.document.macroEnabled.12',
    dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    dotm: 'application/vnd.ms-word.template.macroEnabled.12',
  },
  markdown: { md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8' },
  text: { txt: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8' },
};
export const FILE_TYPES = Object.values(FILE_FORMATS).flatMap(Object.keys);
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
export function fileType(name) {
  const ext = String(name).match(/\.([^.\/\\]+)$/)?.[1].toLowerCase();
  const base = String(name).split(/[\/\\]/).pop().toLowerCase();
  const special = { makefile:'makefile',gnumakefile:'makefile',dockerfile:'dockerfile','cmakelists.txt':'cmake','.bashrc':'bash','.zshrc':'bash' };
  if (Object.hasOwn(special,base)) return { ext: /^[a-z0-9]+$/.test(ext||'') ? ext : 'txt', kind:'code',mime:'text/plain; charset=utf-8',language:special[base] };
  for (const [kind, types] of Object.entries(FILE_FORMATS)) {
    if (Object.hasOwn(types, ext)) return { ext, kind, mime: types[ext] };
  }
  if (Object.hasOwn(SOURCE_LANGUAGES,ext)) return {ext:/^[a-z0-9]{1,16}$/.test(ext)?ext:'txt',kind:'code',mime:'text/plain; charset=utf-8',language:SOURCE_LANGUAGES[ext]};
  return null;
}

export function opaqueType(name) {
  const ext = String(name).match(/\.([a-z0-9]{1,16})$/i)?.[1].toLowerCase() || 'bin';
  return { ext,kind:'unsupported',mime:'application/octet-stream' };
}

export async function validateText(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const check = (text) => {
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error('Not a UTF-8 text document');
  };
  for await (const chunk of chunks) check(decoder.decode(chunk, { stream: true }));
  check(decoder.decode());
}
export function validatePdf(first, last) {
  const text = new TextDecoder('latin1');
  if (!text.decode(first).startsWith('%PDF-') || !text.decode(last).includes('%%EOF')) throw new Error('Invalid PDF document');
}
