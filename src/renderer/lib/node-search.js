// Finding nodes by name (Ctrl+F in the tree). Plain functions, no DOM.

/** Case- and accent-insensitive form: "zurich" finds "Zürich", "istanbul" finds "İstanbul". */
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ids of the nodes matching `query`, best first: exact title, title prefix, a word in the title,
 * anywhere in the title, all words in the title, then all words in the title, description or web
 * address. Equal matches keep tree order. Folded branches are searched too.
 */
export function findNodes(project, query, limit = 50) {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (!q) return [];
  const words = q.split(' ');
  const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(q)}`, 'u');
  const rank = (n) => {
    const title = fold(n.title);
    if (title === q) return 0;
    if (title.startsWith(q)) return 1;
    if (wordStart.test(title)) return 2;
    if (title.includes(q)) return 3;
    if (words.every((w) => title.includes(w))) return 4;
    const more = fold(`${n.description || ''} ${n.type === 'web' ? host(n.url) : ''}`);
    if (words.every((w) => title.includes(w) || more.includes(w))) return 5;
    return -1;
  };
  const hits = [];
  const seen = new Set();
  const visit = (id) => {
    const n = project.nodes[id];
    if (!n || seen.has(id)) return;
    seen.add(id);
    const r = rank(n);
    if (r >= 0) hits.push({ id, r, order: seen.size });
    n.children.forEach(visit);
  };
  for (const id of project.roots || [project.rootId]) visit(id);
  return hits.sort((a, b) => a.r - b.r || a.order - b.order).slice(0, limit).map((hit) => hit.id);
}
