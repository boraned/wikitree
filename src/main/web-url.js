// Web nodes only hold http(s) addresses (kept free of Electron imports so plain Node code can use it).
export function checkWebUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error('Not a web address'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https pages can be opened');
  return url.href;
}
