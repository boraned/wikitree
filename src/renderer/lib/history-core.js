// Project history format shared by the desktop main process, the web app and the history tools.
// Each change is a compact delta against the previous revision. A full snapshot is stored only
// once the deltas written since the last one add up to the project's own size, so a project that
// grows one node at a time keeps a handful of snapshots instead of one per N revisions.

export const HISTORY_FORMAT = 2;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PROJECT_KEYS = ['id', 'title', 'label', 'created', 'rootId', 'roots', 'cover', 'nodeScale'];

/**
 * Delta from `previous` to `current`, or null when nothing changed.
 * `touched` (optional) limits the node comparison to those ids, for callers that know what they changed.
 */
export function diffProjects(previous, current, touched = null) {
  const nodes = {};
  const removed = [];
  const ids = touched ? [...new Set(touched)] : Object.keys(current.nodes);
  for (const id of ids) {
    const node = current.nodes[id];
    const before = previous.nodes[id];
    if (!node) { if (before) removed.push(id); continue; }
    if (!before) { nodes[id] = node; continue; }
    const keys = new Set([...Object.keys(before), ...Object.keys(node)]);
    const unset = [...keys].filter((key) => key !== 'children' && !(key in node));
    const fields = {};
    for (const key of keys) if (key !== 'children' && key in node && !same(before[key], node[key])) fields[key] = node[key];
    let childrenPatch;
    if (!same(before.children, node.children)) {
      let start = 0;
      while (start < before.children.length && start < node.children.length && before.children[start] === node.children[start]) start++;
      let oldEnd = before.children.length;
      let newEnd = node.children.length;
      while (oldEnd > start && newEnd > start && before.children[oldEnd - 1] === node.children[newEnd - 1]) { oldEnd--; newEnd--; }
      childrenPatch = { start, remove: oldEnd - start, insert: node.children.slice(start, newEnd) };
    }
    if (unset.length || Object.keys(fields).length || childrenPatch) nodes[id] = { fields, unset, childrenPatch };
  }
  if (!touched) for (const id of Object.keys(previous.nodes)) if (!current.nodes[id]) removed.push(id);
  const project = {};
  for (const key of PROJECT_KEYS) if (!same(previous[key], current[key])) project[key] = current[key];
  if (!Object.keys(nodes).length && !removed.length && !Object.keys(project).length) return null;
  return { format: HISTORY_FORMAT, project, nodes, removed, summary: summarize(previous, current, nodes, removed, project) };
}

function summarize(previous, current, nodes, removed, project) {
  const added = Object.keys(nodes).filter((id) => !previous.nodes[id]);
  const changed = Object.keys(nodes).filter((id) => previous.nodes[id]);
  const title = (id) => current.nodes[id]?.title ?? previous.nodes[id]?.title ?? '';
  if (added.length === 1) {
    const parent = current.nodes[added[0]].parent;
    return parent == null ? `Added: ${title(added[0])}` : `Added: ${title(added[0])} under ${title(parent)}`;
  }
  if (added.length > 1) return `Added ${added.length} nodes`;
  if (removed.length === 1) return `Removed: ${previous.nodes[removed[0]].title}`;
  if (removed.length > 1) return `Removed ${removed.length} nodes`;
  const reparented = changed.filter((id) => 'parent' in (nodes[id].fields || {}));
  if (reparented.length === 1) {
    const parent = current.nodes[reparented[0]].parent;
    return parent == null ? `Detached: ${title(reparented[0])}` : `Moved: ${title(reparented[0])} under ${title(parent)}`;
  }
  const moved = changed.filter((id) => ['x', 'y', 'parent'].some((key) => key in (nodes[id].fields || {})));
  if (moved.length) return `Rearranged ${moved.length} node${moved.length === 1 ? '' : 's'}`;
  if (changed.length === 1) return `Updated: ${title(changed[0])}`;
  if (changed.length > 1) return `Updated ${changed.length} nodes`;
  if (project.title) return `Renamed project: ${project.title}`;
  if (project.label) return `Named project: ${project.label}`;
  return 'Project updated';
}

/** Applies one delta in place. */
export function applyDelta(project, delta) {
  Object.assign(project, delta.project);
  for (const id of delta.removed) delete project.nodes[id];
  for (const [id, patch] of Object.entries(delta.nodes)) {
    if (!patch.fields || !Array.isArray(patch.unset)) { project.nodes[id] = patch; continue; }
    const node = { ...project.nodes[id] };
    for (const key of patch.unset) delete node[key];
    Object.assign(node, patch.fields);
    if (patch.childrenPatch) {
      node.children = [...(node.children || [])];
      node.children.splice(patch.childrenPatch.start, patch.childrenPatch.remove, ...patch.childrenPatch.insert);
    }
    project.nodes[id] = node;
  }
  return project;
}

/** True when the deltas since the last snapshot (including this one) weigh as much as the project itself. */
export const needsSnapshot = (bytesSinceSnapshot, projectBytes) => bytesSinceSnapshot >= projectBytes;
