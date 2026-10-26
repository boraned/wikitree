// First launch: a new user with no projects gets the bundled "Tree" example, including its build history.
// Offered once; deleting it later does not bring it back.
import fss, { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirs, validId, projectDir, readSettings, writeSetting } from './paths.js';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'example', 'tree');

// Read/write file by file: the bundle sits inside the packaged app's asar archive.
async function copyTree(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of fss.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else await fs.writeFile(dst, fss.readFileSync(src));
  }
}

export async function seedExample() {
  if (readSettings().exampleOffered) return;
  const existing = (await fs.readdir(dirs.data, { withFileTypes: true })).some((d) => d.isDirectory() && validId(d.name));
  if (!existing) {
    const { id } = JSON.parse(fss.readFileSync(path.join(EXAMPLE, 'project.json'), 'utf8'));
    const tmp = `${projectDir(id)}.${process.pid}.tmp`;
    await fs.rm(tmp, { recursive: true, force: true });
    await copyTree(EXAMPLE, tmp);
    await fs.rename(tmp, projectDir(id));
  }
  await writeSetting('exampleOffered', true);
}
