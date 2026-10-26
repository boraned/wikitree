// Read-only, bounded attachment inspection. Never interprets attachment bytes as active content.
import { h } from './dom.js';
import { HIGHLIGHT_LANGUAGES } from './source-languages.js';

export const FILE_PAGE_SIZE = 16384;
let highlighter;
const loadHighlighter = () => highlighter ||= import('../assets/vendor/highlight.esm.js').then((m) => m.default);

export function formatBytes(bytes, mode, offset = 0) {
  if (mode === 'text' || mode === 'source') return new TextDecoder().decode(bytes);
  const width = mode === 'binary' ? 8 : mode === 'ascii' ? 64 : 16;
  const printable = (b) => b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
  const lines = [];
  for (let i = 0; i < bytes.length; i += width) {
    const row = [...bytes.subarray(i,i+width)];
    const address = (offset+i).toString(16).padStart(8,'0');
    const ascii = row.map(printable).join('');
    if (mode === 'ascii') { lines.push(`${address}  ${ascii}`); continue; }
    const radix = mode === 'binary' ? 2 : mode === 'decimal' ? 10 : mode === 'octal' ? 8 : 16;
    const digits = radix === 2 ? 8 : radix === 16 ? 2 : 3;
    lines.push(`${address}  ${row.map((b) => b.toString(radix).padStart(digits,'0')).join(' ').padEnd(width*(digits+1)-1,' ')}  |${ascii}|`);
  }
  return lines.join('\n');
}

export async function readFilePage(url, offset, size, signal, limit = FILE_PAGE_SIZE) {
  if (!size || offset >= size) return new Uint8Array();
  const length = Math.min(limit,size-offset);
  const response = await fetch(url,{headers:{Range:`bytes=${offset}-${offset+length-1}`},signal});
  if (!response.ok) throw new Error('Could not read file');
  // Bound memory even when a host ignores Range and sends a complete response.
  const reader = response.body.getReader();
  const out = new Uint8Array(length);
  let skip = response.status === 206 ? 0 : offset;
  let used = 0;
  try {
    while (used < length) {
      const {value,done} = await reader.read();
      if (done) break;
      const start = Math.min(skip,value.length); skip -= start;
      const chunk = value.subarray(start,start+length-used);
      out.set(chunk,used); used += chunk.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return out.subarray(0,used);
}

export async function readTextPage(url, offset, size, signal) {
  // Emit each complete UTF-8 character on the page containing its first byte.
  // Three trailing context bytes are enough for a four-byte character across the boundary.
  const bytes = await readFilePage(url,offset,size,signal,FILE_PAGE_SIZE+3);
  const continuation = (b) => (b & 0xc0) === 0x80;
  let start = 0, end = Math.min(FILE_PAGE_SIZE,bytes.length);
  while (start < end && continuation(bytes[start])) start++;
  while (end < bytes.length && continuation(bytes[end])) end++;
  return new TextDecoder('utf-8',{ignoreBOM:offset!==0}).decode(bytes.subarray(start,end));
}

export function mountFileInspector(content, node, url) {
  content.classList.add('inspector');
  const modes = [['hex','Hex'],['binary','Binary'],['ascii','ASCII'],['text','Text'],['source','Source'],['decimal','Decimal'],['octal','Octal']];
  const mode = h('select',{class:'file-view-mode','aria-label':'View as'},...modes.map(([value,label]) => h('option',{value},label)));
  mode.value = node.kind === 'code' ? 'source' : node.kind === 'text' ? 'text' : 'hex';
  const language = h('select',{class:'code-language','aria-label':'Language'},...HIGHLIGHT_LANGUAGES.map((l) => h('option',{value:l.id},l.name)));
  language.value = node.language || 'plaintext';
  const prev = h('button',{class:'btn-ghost file-prev'},'Previous');
  const next = h('button',{class:'btn-ghost file-next'},'Next');
  const position = h('span',{class:'file-position'});
  const toolbar = h('div',{class:'file-inspector-tools'},mode,language,h('span',{class:'spacer'}),prev,position,next);
  const body = h('div',{class:'file-inspector-body'});
  content.append(toolbar,body);
  let offset = 0, generation = 0, pending;
  let closed = false;
  async function render() {
    const current = ++generation;
    pending?.abort(); pending = new AbortController();
    language.hidden = mode.value !== 'source';
    prev.disabled = next.disabled = true;
    try {
      const textual = mode.value === 'text' || mode.value === 'source';
      const value = await (textual ? readTextPage : readFilePage)(url,offset,node.size,pending.signal);
      if (closed || current !== generation) return;
      const text = textual ? value : formatBytes(value,mode.value,offset);
      if (mode.value === 'source') {
        const hljs = await loadHighlighter();
        if (closed || current !== generation) return;
        const selected = hljs.getLanguage(language.value) ? language.value : 'plaintext';
        const code = h('code',{class:`source-code hljs language-${selected}`});
        code.innerHTML = hljs.highlight(text,{language:selected,ignoreIllegals:true}).value;
        body.replaceChildren(h('pre',{class:'source-document text-document'},code));
      } else body.replaceChildren(h('pre',{class:node.kind === 'text' && mode.value === 'text' ? 'text-document' : 'byte-view text-document'},text));
      const count = textual ? Math.min(FILE_PAGE_SIZE,node.size-offset) : value.length;
      position.textContent = `${node.size ? offset+1 : 0}–${offset+count} / ${node.size} B`;
      prev.disabled = offset === 0;
      next.disabled = offset+FILE_PAGE_SIZE >= node.size;
    } catch (error) {
      if (closed || current !== generation || error.name === 'AbortError') return;
      body.replaceChildren(h('p',{class:'document-error'},error.message));
    }
  }
  mode.onchange = language.onchange = render;
  prev.onclick = () => { offset = Math.max(0,offset-FILE_PAGE_SIZE); render(); };
  next.onclick = () => { offset += FILE_PAGE_SIZE; render(); };
  render();
  return () => { closed = true; pending?.abort(); };
}
