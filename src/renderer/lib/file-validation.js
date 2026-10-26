// Test the actual runtime decoder before keeping an attachment. No persistent cache or conversions.
import { fileType, opaqueType, MAX_FILE_SIZE, validateText, validatePdf } from './file-types.js';
import { validateWord } from './word.js';

export async function validateAttachmentUrl({ url, kind }) {
  if (kind === 'word') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read file');
    await validateWord(await response.blob());
    return true;
  }
  if (kind === 'text' || kind === 'code' || kind === 'markdown' || kind === 'pdf') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read file');
    if (kind === 'pdf') {
      const blob = await response.blob();
      validatePdf(new Uint8Array(await blob.slice(0,8).arrayBuffer()), new Uint8Array(await blob.slice(-1024).arrayBuffer()));
    } else await validateText(response.body);
    return true;
  }
  if (kind === 'image') {
    const image = new Image();
    let timer;
    try {
      image.src = url;
      await Promise.race([image.decode(), new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Image decode timed out')),15000); })]);
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Unsupported image');
      return true;
    } catch { throw new Error('Unsupported image or damaged file');
    } finally { clearTimeout(timer); image.removeAttribute('src'); }
  }
  const media = document.createElement(kind);
  media.muted = true;
  media.preload = 'auto';
  let timer;
  try {
    await new Promise((resolve,reject) => {
      timer = setTimeout(() => reject(new Error('Media decode timed out')),15000);
      media.onerror = () => reject(new Error('Unsupported media codec or damaged file'));
      media.onloadeddata = resolve;
      media.src = url;
    });
    if (!(media.duration > 0) || (kind === 'video' && (!media.videoWidth || !media.videoHeight))) throw new Error('Unsupported media codec or damaged file');
    return true;
  } finally {
    clearTimeout(timer);
    media.onloadeddata = media.onerror = null;
    media.pause(); media.removeAttribute('src'); media.load();
  }
}

export async function validatePickedFile(file) {
  const type = fileType(file.name);
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} is larger than 2 GB`);
  if (!type) return opaqueType(file.name);
  if (type.kind === 'pdf') {
    try { validatePdf(new Uint8Array(await file.slice(0,8).arrayBuffer()), new Uint8Array(await file.slice(-1024).arrayBuffer())); }
    catch { return opaqueType(file.name); }
    return type;
  }
  const url = URL.createObjectURL(new Blob([file], { type: type.mime }));
  try { await validateAttachmentUrl({ url, kind: type.kind }); }
  catch { return opaqueType(file.name); }
  finally { URL.revokeObjectURL(url); }
  return type;
}
