// Desktop project history: projects/<id>/history/
//   log.jsonl            one line per revision: { seq, at, summary, changes, snapshot? }
//   snapshots/<seq>.json full project copies, written only when the deltas since the last one outweigh it
//   state.json           { seq, bytesSince } for the next append
// Synchronous on purpose: the main process handles one save at a time, including saves from closing windows.
import fss from 'node:fs';
import path from 'node:path';
import { projectDir, writeAtomicSync } from './paths.js';
import { diffProjects, applyDelta, needsSnapshot } from '../renderer/lib/history-core.js';

const dir = (id) => path.join(projectDir(id), 'history');
const logFile = (id) => path.join(dir(id), 'log.jsonl');
const stateFile = (id) => path.join(dir(id), 'state.json');
const snapshotFile = (id, seq) => path.join(dir(id), 'snapshots', `${seq}.json`);

function readState(id) {
  try { return JSON.parse(fss.readFileSync(stateFile(id), 'utf8')); } catch { return null; }
}

function append(id, entry, project, projectBytes) {
  const state = readState(id) || { seq: 0, bytesSince: 0 };
  const seq = state.seq + 1;
  const line = { seq, at: entry.at, summary: entry.summary, changes: entry.changes || null };
  let bytesSince = state.bytesSince + (entry.changes ? JSON.stringify(entry.changes).length : 0);
  if (!entry.changes || needsSnapshot(bytesSince, projectBytes ?? JSON.stringify(project).length)) {
    fss.mkdirSync(path.dirname(snapshotFile(id, seq)), { recursive: true });
    writeAtomicSync(snapshotFile(id, seq), JSON.stringify(project));
    line.snapshot = true;
    bytesSince = 0;
  }
  fss.mkdirSync(dir(id), { recursive: true });
  fss.appendFileSync(logFile(id), `${JSON.stringify(line)}\n`);
  writeAtomicSync(stateFile(id), JSON.stringify({ seq, bytesSince }));
  return seq;
}

/** First revision: a full snapshot of the project as it is now. */
export function seedHistory(project, summary = 'Project created', at = project.created || Date.now()) {
  return append(project.id, { at, summary }, project);
}

/**
 * Records the change from `previous` to `current` (both whole projects). Projects saved before history existed
 * get their previous state as the first snapshot. Options: summary (overrides the generated one), touched
 * (ids known to have changed), at (timestamp), bytes (size of `current` when the caller already knows it).
 */
export function recordChange(previous, current, opts = {}) {
  const id = current.id;
  if (!readState(id)) {
    if (!previous) return seedHistory(current);
    seedHistory(previous, 'History started', previous.updated || Date.now());
  }
  const changes = diffProjects(previous, current, opts.touched || null);
  if (!changes) return null;
  return append(id, { at: opts.at ?? current.updated ?? Date.now(), summary: opts.summary || changes.summary, changes }, current, opts.bytes);
}

function readLog(id) {
  let text;
  try { text = fss.readFileSync(logFile(id), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export function listHistory(id, beforeSeq = Infinity, limit = 100) {
  const all = readLog(id);
  const older = all.filter((e) => e.seq < (beforeSeq ?? Infinity)).reverse();
  const entries = older.slice(0, limit).map(({ seq, at, summary, snapshot }) => ({ seq, at, summary, snapshot: !!snapshot }));
  return { entries, hasMore: older.length > entries.length };
}

export function snapshotAt(id, targetSeq) {
  const rows = readLog(id).filter((e) => e.seq <= targetSeq);
  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].snapshot) { start = i; break; }
  if (start < 0) throw new Error('Snapshot not found');
  const project = JSON.parse(fss.readFileSync(snapshotFile(id, rows[start].seq), 'utf8'));
  for (const row of rows.slice(start + 1)) {
    applyDelta(project, row.changes);
    project.updated = row.at;
  }
  return project;
}

/** All stored revisions as raw text, so file and media cleanup keeps what a restore could bring back. */
export function historyText(id) {
  const parts = [];
  try { parts.push(fss.readFileSync(logFile(id), 'utf8')); } catch { /* no history yet */ }
  const snaps = path.join(dir(id), 'snapshots');
  for (const f of fss.existsSync(snaps) ? fss.readdirSync(snaps) : []) parts.push(fss.readFileSync(path.join(snaps, f), 'utf8'));
  return parts.join('\n');
}
