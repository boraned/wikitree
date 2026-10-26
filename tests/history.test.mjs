// Desktop project history: compact deltas, size-based snapshots, reconstruction and restore.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, check, finish } from './helpers.mjs';
import { initDirs } from '../src/main/paths.js';
import { createProject, deleteProject, getProject, saveProject, saveProjectSync, restoreSnapshot } from '../src/main/projects.js';
import { listHistory, snapshotAt } from '../src/main/history.js';

await initDirs(HOME);
const project = await createProject({ type: 'header', title: 'History test' });
const N = 300;
for (let i = 1; i <= N; i++) {
  const id = `node${String(i).padStart(6, '0')}`;
  const parent = i > 10 ? `node${String(Math.ceil(i / 10)).padStart(6, '0')}` : project.rootId;
  project.nodes[id] = { id, type: 'wiki', title: `Article ${i}`, lang: 'en', description: 'An article used to measure history size', parent, children: [] };
  project.nodes[parent].children.push(id);
  if (i === N) saveProjectSync(project); else await saveProject(project);
}
// One reparent: node 300 moves to the root.
const moved = project.nodes.node000300;
project.nodes[moved.parent].children = project.nodes[moved.parent].children.filter((c) => c !== moved.id);
moved.parent = project.rootId;
project.nodes[project.rootId].children.push(moved.id);
await saveProject(project);
await saveProject(project); // unchanged: no revision

const all = listHistory(project.id, Infinity, 1000);
check('every save becomes one revision, unchanged saves add none', all.entries.length === N + 2 && !all.hasMore, `${all.entries.length}`);
check('additions and moves are named', all.entries.at(-2).summary === 'Added: Article 1 under History test'
  && all.entries[0].summary === 'Moved: Article 300 under History test', `${all.entries.at(-2).summary} / ${all.entries[0].summary}`);
const snapshots = all.entries.filter((e) => e.snapshot).length;
check('snapshots are size-based, not one per N revisions', snapshots >= 3 && snapshots <= 12, `${snapshots} snapshots`);

const historyDir = path.join(HOME, 'projects', project.id, 'history');
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((s, e) => s + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const stored = size(historyDir);
const projectBytes = fs.statSync(path.join(HOME, 'projects', project.id, 'project.json')).size;
check('history stays within a few project-sizes', stored < projectBytes * 6, `${stored} bytes for a ${projectBytes}-byte project`);

const at151 = snapshotAt(project.id, 151);
check('any revision is rebuilt exactly', Object.keys(at151.nodes).length === 151 && at151.nodes.node000150.title === 'Article 150');
const latest = snapshotAt(project.id, all.entries[0].seq);
check('latest revision equals the saved project', JSON.stringify(latest.nodes) === JSON.stringify((await getProject(project.id)).nodes));

await restoreSnapshot({ projectId: project.id, seq: 151 });
const restored = await getProject(project.id);
const after = listHistory(project.id, Infinity, 1);
check('restore replaces the project and is itself a revision', Object.keys(restored.nodes).length === 151
  && after.entries[0].summary === 'Restored snapshot 151' && after.hasMore);

// Projects saved before history existed keep their prior state as the first snapshot.
const legacy = await createProject({ type: 'header', title: 'Legacy' });
fs.rmSync(path.join(HOME, 'projects', legacy.id, 'history'), { recursive: true });
legacy.nodes.extra = { id: 'extra', type: 'header', title: 'Extra', parent: legacy.rootId, children: [] };
legacy.nodes[legacy.rootId].children.push('extra');
await saveProject(legacy);
const legacyLog = listHistory(legacy.id).entries;
check('older projects start history on their next save', legacyLog.length === 2 && legacyLog[1].summary === 'History started' && legacyLog[1].snapshot);

await deleteProject(project.id);
await deleteProject(legacy.id);
finish();
