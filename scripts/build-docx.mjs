// Rebuild the offline Word (.docx) renderer from the pinned dev dependencies.
import fs from 'node:fs/promises';
import { build } from 'esbuild';

await build({
  stdin: { contents: "export { renderAsync, parseAsync } from 'docx-preview';", resolveDir: process.cwd(), loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'none',
  outfile: 'src/renderer/assets/vendor/docx-preview.esm.js',
});
await fs.copyFile('node_modules/docx-preview/LICENSE', 'src/renderer/assets/vendor/docx-preview.LICENSE');
await fs.copyFile('node_modules/jszip/LICENSE.markdown', 'src/renderer/assets/vendor/jszip.LICENSE.md');
const { size } = await fs.stat('src/renderer/assets/vendor/docx-preview.esm.js');
console.log(`Bundled docx-preview and JSZip (${size} bytes).`);
