import { expandGenerations, setAllCollapsed } from '../src/renderer/lib/tree-visibility.js';

function perfectBinary(depth) {
  const nodes = {};
  const size = 2 ** (depth + 1) - 1;
  for (let i = 0; i < size; i++) {
    const children = [2 * i + 1, 2 * i + 2].filter((x) => x < size).map(String);
    nodes[i] = { id: String(i), children, collapsed: children.length > 0 };
  }
  return nodes;
}
function visibleCount(nodes, root = '0') {
  let count = 0;
  const visit = (id) => { const n = nodes[id]; count++; if (!n.collapsed) n.children.forEach(visit); };
  visit(root);
  return count;
}
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const nodes = perfectBinary(6); // 127 nodes; five generations expose 2 + 4 + 8 + 16 + 32 descendants
setAllCollapsed(nodes, false); // Expansion stays within five generations even if the hidden branch was open earlier.
check('five-generation expand changes a fully open tree', expandGenerations(nodes, '0', 5));
check('five-generation expand exposes exactly 2^5 leaves', visibleCount(nodes) === 63, `visible=${visibleCount(nodes)}`);
check('the sixth generation remains collapsed', nodes['31'].collapsed && nodes['62'].collapsed);
check('shrink all leaves only the root visible', setAllCollapsed(nodes, true) && visibleCount(nodes) === 1);
check('expand all exposes the complete tree', setAllCollapsed(nodes, false) && visibleCount(nodes) === 127);
check('repeat expand/shrink calls are idempotent', !setAllCollapsed(nodes, false) && !setAllCollapsed(nodes, false));
if (process.exitCode) process.exit(process.exitCode);
