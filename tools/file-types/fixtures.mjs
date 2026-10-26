// Generate real, small fixtures for every attachment format. Requires ffmpeg and ImageMagick.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import JSZip from 'jszip';

const WORD_MAIN = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
};
/** A two-page Word document: heading, formatted text, a table, an embedded picture and a page break. */
async function wordDocument(ext, png) {
  const zip = new JSZip();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const p = (text, props = '') => `<w:p><w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  const picture = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2286000" cy="1285875"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="sample.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="1285875"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const body = [
    p('WikiTree Word test', '<w:b/><w:sz w:val="40"/>'),
    `<w:p><w:r><w:t xml:space="preserve">This </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r><w:r><w:t xml:space="preserve"> text must render as a page. Ağaç, İstanbul.</w:t></w:r></w:p>`,
    `<w:tbl><w:tblPr><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(border).join('')}</w:tblBorders></w:tblPr><w:tr>${cell('Format')}${cell(ext.toUpperCase())}</w:tr><w:tr>${cell('Pages')}${cell('2')}</w:tr></w:tbl>`,
    picture,
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    p('Second page of the WikiTree Word test.'),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
  ].join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${WORD_MAIN[ext]}"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/sample.png"/></Relationships>');
  zip.file('word/media/sample.png', png);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function makeFixtures(dir) {
  await fs.mkdir(dir, { recursive: true });
  const fixtures = [];
  const add = (ext, kind) => {
    const file = path.join(dir, `${ext.toUpperCase()} sample.${ext}`);
    fixtures.push({ ext, kind, path: file });
    return file;
  };
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const magick = spawnSync('magick',['-version']).error ? 'convert' : 'magick';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" rx="14" fill="#26374b"/><circle cx="52" cy="84" r="22" fill="#42c968"/><text x="92" y="94" font-family="sans-serif" font-size="24" fill="white">WikiTree image</text></svg>`;
  const source = path.join(dir, 'source.svg');
  await fs.writeFile(source, svg);
  for (const ext of ['png','jpg','jpeg','webp','avif','bmp']) run(magick, ['-background', '#26374b', source, add(ext, 'image')]);
  await fs.writeFile(add('svg', 'image'), svg);
  run(magick, ['-delay', '30', '-size', '160x90', 'xc:#26374b', '-size', '160x90', 'xc:#42c968', '-loop', '0', add('gif', 'image')]);
  for (const [ext, codec] of [['mp3','libmp3lame'],['wav','pcm_s16le'],['ogg','libvorbis'],['oga','libvorbis'],['m4a','aac'],['aac','aac'],['flac','flac'],['opus','libopus']]) {
    run('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1.5','-c:a',codec, add(ext,'audio')]);
  }
  for (const [ext, video, audio] of [['mp4','libx264','aac'],['m4v','libx264','aac'],['webm','libvpx-vp9','libopus'],['mov','libx264','aac'],['ogv','libtheora','libvorbis']]) {
    const file = add(ext, 'video');
    run('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=240x136:rate=12:duration=1.5','-f','lavfi','-i','sine=frequency=660:duration=1.5','-c:v',video,'-pix_fmt','yuv420p','-c:a',audio,'-shortest',...(ext === 'm4v' ? ['-f','mp4'] : []),file]);
  }
  const stream = 'BT /F1 24 Tf 60 720 Td (WikiTree PDF test) Tj 0 -40 Td /F1 14 Tf (This page must render inside WikiTree.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object,i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(add('pdf','pdf'), pdf);
  const png = await fs.readFile(path.join(dir, 'PNG sample.png'));
  for (const ext of Object.keys(WORD_MAIN)) await fs.writeFile(add(ext, 'word'), await wordDocument(ext, png));
  for (const ext of ['md','markdown']) await fs.writeFile(add(ext,'markdown'), '# WikiTree Markdown test\n\n**Bold**, *italic*, and a list:\n\n- First item\n- Second item\n\nTurkish: Ağaç, İstanbul.\n');
  for (const [ext,text] of [['txt','WikiTree plain-text test\nAğaç, İstanbul.\n'],['csv','name,value\nWikiTree,42\n'],['json','{"application":"WikiTree","test":true}\n'],['log','INFO WikiTree log test\n']]) await fs.writeFile(add(ext,'text'),text);
  const rejected = [];
  for (const ext of ['exe','zip','docx','html','mkv','tiff','constructor']) {
    const file = path.join(dir, `Unsupported.${ext}`);
    await fs.writeFile(file, 'Not a supported attachment.\n');
    rejected.push(file);
  }
  for (const ext of ['png','mp4','pdf','txt']) {
    const file = path.join(dir, `Corrupt.${ext}`);
    await fs.writeFile(file, Buffer.from([0,255,1,2,3,0,4]));
    rejected.push(file);
  }
  const badCodec = path.join(dir,'Unsupported codec.mp4');
  run('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=8:duration=1','-c:v','mpeg4',badCodec]);
  rejected.push(badCodec);
  const manifest = { fixtures, rejected };
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!process.argv[2]) throw new Error('Usage: node tools/file-types/fixtures.mjs OUTPUT_DIR');
  const manifest = await makeFixtures(path.resolve(process.argv[2]));
  console.log(`Generated ${manifest.fixtures.length} real samples and ${manifest.rejected.length} rejection fixtures.`);
}
