import assert from 'node:assert/strict';
import http from 'node:http';
import { formatBytes, readFilePage, readTextPage, FILE_PAGE_SIZE } from '../src/renderer/lib/file-inspect.js';
import { fileType, opaqueType } from '../src/renderer/lib/file-types.js';
import { HIGHLIGHT_LANGUAGES } from '../src/renderer/lib/source-languages.js';
import hljs from '../src/renderer/assets/vendor/highlight.esm.js';

const bytes = new Uint8Array([0,65,127,255,10]);
assert.ok(formatBytes(bytes,'hex').includes('00 41 7f ff 0a'));
assert.ok(formatBytes(bytes,'binary').includes('11111111'));
assert.ok(formatBytes(bytes,'ascii').includes('.A...'));
assert.ok(formatBytes(bytes,'decimal').includes('255'));
assert.ok(formatBytes(bytes,'octal').includes('377'));
assert.ok(formatBytes(bytes,'text').includes('A'));
assert.equal(formatBytes(new Uint8Array(),'hex'),'');
assert.ok(formatBytes(bytes,'hex',16384).startsWith('00004000'));
assert.equal(fileType('Example.c++').kind,'code');
assert.equal(fileType('Example.c++').ext,'txt');
assert.equal(fileType('Example.py').language,'python');
assert.equal(fileType('Dockerfile').language,'dockerfile');
assert.equal(fileType('CMakeLists.txt').language,'cmake');
assert.equal(fileType('note.txt').kind,'text');
assert.equal(fileType('x.constructor'),null);
assert.equal(opaqueType('no-extension').ext,'bin');
assert.equal(opaqueType('odd.long-unsafe-suffix').ext,'bin');
for (const language of HIGHLIGHT_LANGUAGES) {
  assert.ok(hljs.getLanguage(language.id));
  assert.equal(typeof hljs.highlight('sample = 42; // comment',{language:language.id,ignoreIllegals:true}).value,'string');
}
console.log(`✓ exact byte representations and all ${HIGHLIGHT_LANGUAGES.length} bundled grammar definitions`);
const buffer = Buffer.from(Array.from({length:50000},(_,i)=>i%256));
const source='A'.repeat(FILE_PAGE_SIZE-1)+'🌳漢字Türkçe\n';
let utf8=Buffer.from(source);
let requestedRange;
const server = http.createServer((req,res)=>{
  requestedRange=req.headers.range;
  // Deliberately ignore Range: the reader must skip/limit a streaming 200 response itself.
  res.writeHead(200,{'content-type':'application/octet-stream'}).end(req.url==='/utf8'?utf8:buffer);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const url=`http://127.0.0.1:${server.address().port}/sample`;
  const page=await readFilePage(url,16384,buffer.length);
  assert.equal(page.length,FILE_PAGE_SIZE);
  assert.ok(Buffer.from(page).equals(buffer.subarray(16384,32768)));
  assert.equal(requestedRange,'bytes=16384-32767');
  let decoded='';
  for(let offset=0;offset<utf8.length;offset+=FILE_PAGE_SIZE)decoded+=await readTextPage(`${url}/../utf8`,offset,utf8.length);
  assert.equal(decoded.slice(-100),source.slice(-100),'UTF-8 characters crossing byte-page boundaries remain intact');
  for(const char of ['é','漢','🌳'])for(let split=1;split<Buffer.byteLength(char);split++){
    const text='A'.repeat(FILE_PAGE_SIZE-split)+char+'tail';utf8=Buffer.from(text);let joined='';
    for(let offset=0;offset<utf8.length;offset+=FILE_PAGE_SIZE)joined+=await readTextPage(`${url}/../utf8`,offset,utf8.length);
    assert.equal(joined,text,`preserve ${char} across every possible byte split`);
  }
  console.log('✓ UTF-8 remains intact across every two-, three- and four-byte character split');
  assert.equal((await readFilePage(url,0,0)).length,0);
  const abort=new AbortController();abort.abort();
  await assert.rejects(readFilePage(url,0,buffer.length,abort.signal));
  console.log('✓ bounded reads also handle hosts ignoring Range, empty files and cancellation');
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
