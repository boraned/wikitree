// Native attachment rendering plus safe fallback for unknown or undecodable bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, launch, finish } from './helpers.mjs';
import { makeFixtures } from '../tools/file-types/fixtures.mjs';
import { FILE_TYPES } from '../src/renderer/lib/file-types.js';

const dir = process.env.WIKITREE_FILE_FIXTURES || path.join(HOME, 'file-type-fixtures');
const manifestPath = path.join(dir, 'manifest.json');
const { fixtures, rejected } = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : await makeFixtures(dir);
const expected = fixtures.filter((f) => f.ext !== 'ogv');
assert.equal(expected.length, 31);
assert.deepEqual(new Set(expected.map((f)=>f.ext)),new Set(FILE_TYPES),'every allowed suffix must have a real fixture');
const reportPath = process.env.WIKITREE_FILE_REPORT || path.join(HOME, 'file-type-results.jsonl');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, '');
const record = (value) => { fs.appendFileSync(reportPath, `${JSON.stringify(value)}\n`); console.log(JSON.stringify(value)); };
const { app, win } = await launch();
let p;
try {
  await win.waitForSelector('.wordmark');
  p = await win.evaluate(() => window.wikitree.createProject({ type: 'header', title: 'File type tests' }));
  const labels = { image: 'Images', video: 'Video', audio: 'Audio', pdf: 'PDF', word: 'Word', markdown: 'Markdown', text: 'Text', code:'Source',unsupported:'Unsupported' };
  for (const [kind,title] of Object.entries(labels)) {
    const id = `group${kind}`;
    p.nodes[id] = { id, type: 'header', title, parent: p.rootId, children: [] };
    p.nodes[p.rootId].children.push(id);
  }
  for (const [i,fixture] of expected.entries()) {
    const data = await win.evaluate(({id,file}) => window.wikitree.importFile(id,file), {id:p.id,file:fixture.path});
    assert.equal(data.kind,fixture.kind);
    const id = `sample${i}`;
    p.nodes[id] = { id,...data,parent:`group${data.kind}`,children:[] };
    p.nodes[`group${data.kind}`].children.push(id);
    fixture.nodeId = id;
  }
  await win.evaluate(async (p) => { await window.wikitree.saveProject(p); location.hash=`#/p/${p.id}`; }, p);
  await win.waitForSelector('.node.file');
  await win.waitForTimeout(400);
  await win.locator('.file-full-image').evaluateAll((imgs) => Promise.all(imgs.map((img) => img.decode())));
  await win.click('.icon-btn[title="Fit"]');
  await win.waitForTimeout(100); // offscreen GIFs are intentionally animation-throttled by Chromium
  for (const fixture of expected.filter((f) => ['image','audio','video'].includes(f.kind))) {
    const result = await win.locator(`.node[data-id="${fixture.nodeId}"]`).evaluate(async (el,kind) => {
      if (kind === 'image') {
        const img=el.querySelector('img');await img.decode();
        return { width:img.naturalWidth,height:img.naturalHeight };
      }
      const m=el.querySelector(kind);m.muted=true;m.load();
      await Promise.race([new Promise((res,rej)=>{m.onloadeddata=res;m.onerror=()=>rej(Error(m.error?.message||'Decode failed'));}),new Promise((_,rej)=>setTimeout(()=>rej(Error('Playback timeout')),6000))]);
      await m.play();await new Promise((res)=>setTimeout(res,250));
      const result={seconds:m.duration,time:m.currentTime,...(kind==='video'?{width:m.videoWidth,frames:m.getVideoPlaybackQuality().totalVideoFrames}:{})};m.pause();return result;
    },fixture.kind);
    assert.ok(fixture.kind==='image' ? result.width>0&&result.height>0 : result.time>0&&result.seconds>0);
    if(fixture.kind==='video') assert.ok(result.width>0&&result.frames>0,`video must decode pictures, not just audio: ${fixture.ext}`);
    if(fixture.ext==='gif') {
      // Canvas drawImage may use an animated image's default frame; compare actual rendered pixels.
      const image = win.locator(`.node[data-id="${fixture.nodeId}"] img`);
      const first = await image.screenshot();
      result.animated = false;
      for(let i=0;i<6&&!result.animated;i++) {
        await win.waitForTimeout(170+i*31);
        result.animated = !first.equals(await image.screenshot());
      }
      assert.equal(result.animated,true,'GIF animation must advance, not just show a still');
    }
    record({ext:fixture.ext,kind:fixture.kind,passed:true,...result});
  }
  for(const fixture of expected.filter((f)=>['markdown','text','pdf','word'].includes(f.kind))) {
    await win.evaluate(({p,id})=>location.hash=`#/p/${p}/w/${id}`,{p:p.id,id:fixture.nodeId});
    if(fixture.kind==='word') {
      await win.waitForSelector('.document-content.word section.docx');
      const page = await win.evaluate(()=>{
        const pages=[...document.querySelectorAll('.document-content.word section.docx')];
        const img=document.querySelector('.document-content.word img');
        const r=pages[0].getBoundingClientRect();
        return {pages:pages.length,text:pages.map(s=>s.textContent).join(' '),bold:!!pages[0].querySelector('span[style*="font-weight: bold"], b, strong'),
          table:!!pages[0].querySelector('table td'),image:!!img&&img.complete&&img.naturalWidth>0,links:document.querySelectorAll('.document-content a[href]').length,
          ratio:r.height/r.width,colour:getComputedStyle(pages[0]).backgroundColor,textColour:getComputedStyle(pages[0].querySelector('p')||pages[0]).color,
          centred:Math.abs((r.left+r.right)/2-document.querySelector('.document-scroll').getBoundingClientRect().width/2)<20};
      });
      assert.equal(page.colour,'rgb(255, 255, 255)',`${fixture.ext}: white page`);
      assert.equal(page.textColour,'rgb(0, 0, 0)',`${fixture.ext}: black text`);
      assert.ok(page.centred,`${fixture.ext}: page centred like a PDF viewer`);
      assert.ok(page.pages>=2,`${fixture.ext}: page break makes a second page`);
      assert.ok(page.text.includes('WikiTree Word test')&&page.text.includes('Second page')&&page.text.includes('Ağaç'),`${fixture.ext}: text`);
      assert.ok(page.bold&&page.table&&page.image,`${fixture.ext}: formatting, table and picture render ${JSON.stringify(page)}`);
      assert.equal(page.links,0);
      assert.ok(Math.abs(page.ratio-16838/11906)<0.02,`${fixture.ext}: A4 page proportions ${page.ratio}`);
      if(fixture.ext==='docx'&&process.env.WIKITREE_SCREENSHOT_DIR){fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR,{recursive:true});await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'file-type-docx.png')});}
    } else if(fixture.kind==='pdf') {
      await win.waitForSelector('.pdf-frame');
      await win.waitForFunction(()=>document.querySelector('.pdf-frame')?.contentWindow!=null);
      let pdfFrame;
      for(let i=0;i<40;i++){pdfFrame=win.frames().find((f)=>f.url().startsWith('chrome-extension://'));if(pdfFrame)break;await win.waitForTimeout(100);}
      assert.ok(pdfFrame,'in-app PDF viewer loads');
      await pdfFrame.waitForSelector('pdf-viewer');
      await win.waitForTimeout(700);
      if(process.env.WIKITREE_SCREENSHOT_DIR){fs.mkdirSync(process.env.WIKITREE_SCREENSHOT_DIR,{recursive:true});await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'file-type-pdf.png')});}
    } else {
      await win.waitForSelector(fixture.kind==='markdown'?'.markdown-article':'.text-document');
      assert.ok((await win.locator('.document-content').textContent()).includes('WikiTree'));
    }
    record({ext:fixture.ext,kind:fixture.kind,passed:true,reader:true});
  }
  for(const file of [...rejected,fixtures.find((f)=>f.ext==='ogv').path]) {
    const data = await win.evaluate(({id,file})=>window.wikitree.importFile(id,file),{id:p.id,file});
    const expectedKind = file.endsWith('.html') ? 'code' : 'unsupported';
    assert.equal(data.kind,expectedKind,`preserve an inspectable fallback: ${path.basename(file)}`);
    assert.ok(fs.readFileSync(path.join(HOME,'projects',p.id,'files',data.file)).equals(fs.readFileSync(file)),'keep the original bytes');
    await win.evaluate(async(data)=>{const s=await import('./lib/store.js');s.addNode(`group${data.kind}`,data);await s.flush();},data);
    record({file:path.basename(file),preserved:true,kind:data.kind});
  }
  assert.equal(fs.readdirSync(path.join(HOME,'projects',p.id,'files')).length,44,'all samples are copied exactly once');
  const beforeRoots=(await win.evaluate(()=>window.wikitree.projects())).length;
  const opaqueRoot = await win.evaluate((file)=>window.wikitree.createProject({type:'file',paths:[file]}),rejected.find((f)=>path.basename(f)==='Unsupported codec.mp4'));
  assert.equal(opaqueRoot.nodes[opaqueRoot.rootId].kind,'unsupported');
  await win.evaluate(id=>window.wikitree.deleteProject(id),opaqueRoot.id);
  assert.equal((await win.evaluate(()=>window.wikitree.projects())).length,beforeRoots);
  await win.evaluate((id)=>location.hash=`#/p/${id}`,p.id);
  await win.waitForSelector('.node.file');
  await win.click('.icon-btn[title="Fit"]');
  await win.click('.node.is-root .add');
  await win.click('.modal .tab-file');
  const accepts=await win.locator('.modal input[type=file]').getAttribute('accept');
  assert.equal(accepts,null,'picker allows arbitrary file types');
  await win.setInputFiles('.modal input[type=file]',[expected.find(f=>f.ext==='txt').path,rejected[0]]);
  await win.waitForSelector('.modal',{state:'detached'});
  await win.waitForSelector('.node.file:has-text("Unsupported.exe")');
  await win.click('.node.is-root .add');
  await win.click('.modal .tab-file');
  await win.setInputFiles('.modal input[type=file]', rejected.find((f) => path.basename(f)==='Corrupt.png'));
  await win.waitForSelector('.modal',{state:'detached'});
  await win.waitForSelector('.node.file:has-text("Corrupt.png")');
  console.log('✓ mixed and damaged-file selections are retained as safe attachments');
  await win.evaluate(async()=>{const s=await import('./lib/store.js');await s.flush();});
  const rows=fs.readFileSync(reportPath,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(r=>r.passed).length,31);
  assert.equal(rows.filter(r=>r.preserved).length,13);
  const report=path.join(dir,'Test results.md');
  fs.writeFileSync(report,`# File type tests\n\nVerified in the Linux Electron app.\n\n${rows.filter(r=>r.passed).map(r=>`- **.${r.ext}**: ${r.kind==='video'?'video frames decoded; playback tested explicitly (no autoplay)':r.kind==='audio'?'audio decoded and playback advanced':r.reader?'opened in the app reader':'image decoded'}`).join('\n')}\n\n## Preserved for inspection\n\n${rows.filter(r=>r.preserved).map(r=>`- ${r.file}: ${r.kind}`).join('\n')}\n\nUnrecognized or undecodable files remain inspectable; they are not executed.\n`);
  const data=await win.evaluate(({id,file})=>window.wikitree.importFile(id,file),{id:p.id,file:report});
  await win.evaluate(async(data)=>{
    const store=await import('./lib/store.js');
    store.addNode(store.current().rootId,data);
    for(const n of Object.values(store.current().nodes)) if(n.type==='header'&&n.parent!=null)n.collapsed=true;
    store.changed();await store.flush();location.reload();
  },data);
  await win.waitForSelector('.node.is-root');
  await win.waitForTimeout(400);
  await win.click('.icon-btn[title="Arrange"]');
  await win.click('.icon-btn[title="Fit"]');
  await win.evaluate(() => new Promise(requestAnimationFrame));
  await win.evaluate(async()=>{const s=await import('./lib/store.js');await s.flush();});
  if(process.env.WIKITREE_SCREENSHOT_DIR)await win.screenshot({path:path.join(process.env.WIKITREE_SCREENSHOT_DIR,'file-type-project.png')});
  console.log(`Verified 31 native formats; preserved 13 fallback cases. PROJECT=${p.id} HOME=${HOME}`);
} finally {
  await app.close();
  if(p&&!process.env.WIKITREE_KEEP_FILE_PROJECT)fs.rmSync(path.join(HOME,'projects',p.id),{recursive:true,force:true});
}
finish();
