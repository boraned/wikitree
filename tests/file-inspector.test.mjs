// Unknown attachments, highlighted source, bounded byte pages and click-to-play video.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, launch, finish } from './helpers.mjs';
import { makeFixtures } from '../tools/file-types/fixtures.mjs';

const dir=path.join(HOME,'inspector-fixtures');
fs.mkdirSync(dir,{recursive:true});
const raw=path.join(dir,'example.unknown');
fs.writeFileSync(raw,Buffer.from([0,65,127,255,10]));
const large=path.join(dir,'large.bin');
fs.writeFileSync(large,Buffer.alloc(40000,0x41));
const snippets={c:'#include <stdio.h>\nint main(void) { return 0; }\n',cpp:'#include <iostream>\nint main() { return 0; }\n',java:'public class Example { public static void main(String[] args) {} }\n',py:'def hello(name):\n    return "Hello " + name\n',rs:'fn main() { let number: i32 = 42; }\n',js:'const literal = "<img src=x onerror=alert(1)>";\n'};
for(const [ext,text] of Object.entries(snippets))fs.writeFileSync(path.join(dir,`Example.${ext}`),text);
fs.writeFileSync(path.join(dir,'note.txt'),'Plain text: <b>not HTML</b>\n');
const manifestFile=path.join(HOME,'file-type-fixtures','manifest.json');
const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile)):await makeFixtures(path.dirname(manifestFile));
const {app,win}=await launch();let p;
try{
 await win.waitForSelector('.wordmark');
 p=await win.evaluate(()=>window.wikitree.createProject({type:'header',title:'Inspector test'}));
 const inputs=[raw,large,...Object.keys(snippets).map(ext=>path.join(dir,`Example.${ext}`)),path.join(dir,'note.txt'),manifest.fixtures.find(f=>f.ext==='mp4').path];
 const imported=[];
 for(const [i,file] of inputs.entries()){
  const data=await win.evaluate(({id,file})=>window.wikitree.importFile(id,file),{id:p.id,file});
  imported.push(data);const id=`inspect${i}`;p.nodes[id]={id,...data,parent:p.rootId,children:[]};p.nodes[p.rootId].children.push(id);
 }
 assert.equal(imported[0].kind,'unsupported');assert.equal(imported[0].title,'example.unknown');
 await win.evaluate(async p=>{await window.wikitree.saveProject(p);location.hash=`#/p/${p.id}`;},p);
 await win.waitForSelector('.node[data-id="inspect0"]');
 assert.equal(await win.locator('.node[data-id="inspect0"] .file-kind').textContent(),'Unsupported file');
 await win.click('.icon-btn[title="Fit"]');
 await win.locator('.node[data-id="inspect0"] .title').click();
 await win.waitForSelector('.byte-view');
 assert.ok((await win.locator('.byte-view').textContent()).includes('00 41 7f ff 0a'));
 if(process.env.WIKITREE_SCREENSHOT_DIR){fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR,{recursive:true});await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'byte-viewer.png')});}
 await win.selectOption('.file-view-mode','binary');
 await win.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.includes('01000001'));
 assert.ok((await win.locator('.byte-view').textContent()).includes('01000001'));
 await win.selectOption('.file-view-mode','ascii');
 await win.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.startsWith('00000000  .A...'));
 assert.ok((await win.locator('.byte-view').textContent()).includes('.A...'));
 await win.selectOption('.file-view-mode','decimal');
 await win.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.includes('255'));
 assert.ok((await win.locator('.byte-view').textContent()).includes('255'));
 await win.selectOption('.file-view-mode','octal');
 await win.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.includes('377'));
 assert.ok((await win.locator('.byte-view').textContent()).includes('377'));
 await win.selectOption('.file-view-mode','text');
 await win.waitForFunction(()=>document.querySelector('.byte-view')?.textContent.includes('\ufffd'));
 assert.ok((await win.locator('.byte-view').textContent()).includes('A'));
 console.log('✓ unknown file is stored, labelled and readable as hex/binary/ASCII/decimal/octal/text');
 await win.evaluate(id=>location.hash=`#/p/${id}/w/inspect1`,p.id);
 await win.waitForSelector('.file-next:not(:disabled)');
 const initial=await win.locator('.file-position').textContent();
 await win.click('.file-next');
 await win.waitForFunction(old=>document.querySelector('.file-position').textContent!==old,initial);
 assert.ok((await win.locator('.byte-view').textContent()).startsWith('00004000'));
 assert.ok((await win.locator('.byte-view').textContent()).length<150000);
 console.log('✓ byte viewer uses bounded 16 KiB pages rather than loading the whole file');
 for(const [index,[ext,text]] of Object.entries(snippets).entries()){
  await win.evaluate(({id,node})=>location.hash=`#/p/${id}/w/${node}`,{id:p.id,node:`inspect${index+2}`});
  await win.waitForSelector('.source-code .hljs-keyword, .source-code .hljs-meta');
  assert.equal(await win.locator('.source-code').textContent(),text);
  assert.equal(await win.locator('.source-code img, .source-code script').count(),0);
  if(ext==='py'&&process.env.WIKITREE_SCREENSHOT_DIR)await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'source-viewer.png')});
 }
 const languages=await win.locator('.code-language option').count();
 assert.ok(languages>=190,`${languages} bundled language grammars`);
 console.log(`✓ C, C++, Java, Python, Rust and JavaScript are highlighted safely; ${languages} language choices`);
 await win.evaluate(id=>location.hash=`#/p/${id}/w/inspect8`,p.id);
 await win.waitForSelector('.text-document');
 assert.equal(await win.locator('.text-document').textContent(),'Plain text: <b>not HTML</b>\n');
 assert.equal(await win.locator('.text-document b').count(),0);
 await win.evaluate(id=>location.hash=`#/p/${id}`,p.id);
 await win.waitForSelector('.node[data-id="inspect9"] video');
 await win.waitForTimeout(400);
 const state=await win.locator('.node[data-id="inspect9"] video').evaluate(v=>({paused:v.paused,time:v.currentTime,autoplay:v.autoplay}));
 assert.deepEqual(state,{paused:true,time:0,autoplay:false});
 await win.click('.icon-btn[title="Fit"]');
 await win.locator('.node[data-id="inspect9"] .title').click();
 await win.waitForSelector('.video-player');
 assert.equal(await win.locator('.video-player').evaluate(v=>v.paused),true);
 assert.equal(await win.locator('.media-play').count(),0,'no separate Play button; the player has its own controls');
 assert.equal(await win.locator('.video-player').evaluate(v=>v.controls),true);
 await win.locator('.video-player').evaluate(v=>v.play());
 await win.waitForFunction(()=>document.querySelector('.video-player')?.currentTime>0.1);
 await win.click('.file-fullscreen');
 await win.waitForFunction(()=>document.fullscreenElement?.tagName==='VIDEO');
 assert.ok(await win.evaluate(()=>{const r=document.fullscreenElement.getBoundingClientRect();return Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2;}),'the video itself fills the screen');
 await win.evaluate(()=>document.exitFullscreen());
 await win.waitForFunction(()=>document.fullscreenElement==null);
 if(process.env.WIKITREE_SCREENSHOT_DIR){fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR,{recursive:true});await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'video-player.png')});}
 await win.click('.tree-btn');
 await win.waitForSelector('.node[data-id="inspect9"] video');
 assert.equal(await win.locator('.node[data-id="inspect9"] video').evaluate(v=>v.paused),true);
 console.log('✓ video stays paused in the tree, opens a larger player with its own controls, plays and toggles fullscreen');
 await win.reload();await win.waitForSelector('.node[data-id="inspect0"]');
 assert.equal(await win.locator('.node[data-id="inspect0"] .file-kind').textContent(),'Unsupported file');
}finally{await app.close();if(p)fs.rmSync(path.join(HOME,'projects',p.id),{recursive:true,force:true});}
finish();
