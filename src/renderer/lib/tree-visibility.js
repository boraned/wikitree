// View-only collapse state helpers for the project tree.
export function expandGenerations(nodes, rootId, generations = 5) {
  if (!Number.isInteger(generations) || generations < 1) return false;
  let changed = false;
  const visit = (id, depth) => {
    const node = nodes[id];
    if (!node?.children.length) return;
    if (depth >= generations) {
      if (!node.collapsed) { node.collapsed = true; changed = true; }
      return;
    }
    if (node.collapsed) { node.collapsed = false; changed = true; }
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(rootId, 0);
  return changed;
}

export function setAllCollapsed(nodes, collapsed) {
  let changed = false;
  for (const node of Object.values(nodes)) {
    if (!node.children.length || Boolean(node.collapsed) === collapsed) continue;
    node.collapsed = collapsed;
    changed = true;
  }
  return changed;
}
