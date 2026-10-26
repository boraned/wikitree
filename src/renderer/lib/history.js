// Project change log and periodic project-state previews for the browser app.
import { h, timeAgo } from './dom.js';

export function openHistory(api, projectId, onRestore) {
  const back = h('div', { class: 'modal-back history-back' });
  const close = h('button', { class: 'history-close icon-btn', title: 'Close history' }, '×');
  const head = h('header', { class: 'history-head' }, h('div', { class: 'history-heading' }, 'Project history'), close);
  const rows = h('div', { class: 'history-rows' });
  const preview = h('section', { class: 'history-preview', hidden: true });
  const content = h('div', { class: 'history-dialog' }, head, rows, preview);
  back.append(content);
  document.body.append(back);

  let closed = false;
  let beforeSeq = Infinity;
  let hasMore = true;
  let busy = false;
  let selected = null;
  const shown = new Set();
  const closeModal = () => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } };
  document.addEventListener('keydown', onKey, true);
  close.onclick = closeModal;
  back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });

  async function select(entry, row) {
    selected = entry.seq;
    rows.querySelectorAll('.history-row').forEach((el) => el.classList.toggle('selected', el === row));
    preview.hidden = false;
    preview.replaceChildren(h('div', { class: 'history-loading' }, 'Loading snapshot…'));
    try {
      const project = await api.historySnapshot(projectId, entry.seq);
      if (closed || selected !== entry.seq) return;
      const ordered = [];
      const visit = (id, depth) => {
        const n = project.nodes[id];
        if (!n || ordered.length >= 40) return;
        ordered.push(h('li', { class: 'snapshot-node', style: `--depth:${Math.min(depth, 8)}` }, h('span', { class: `snapshot-dot ${n.type}` }), h('span', {}, n.title)));
        n.children.forEach((child) => visit(child, depth + 1));
      };
      for (const rootId of project.roots || [project.rootId]) visit(rootId, 0);
      const count = Object.keys(project.nodes).length;
      const restore = h('button', { class: 'btn-green history-restore' }, 'Restore snapshot');
      restore.onclick = async () => {
        restore.disabled = true;
        try { await onRestore(entry); closeModal(); }
        catch (e) { restore.disabled = false; preview.append(h('div', { class: 'history-error' }, e.message)); }
      };
      preview.replaceChildren(
        h('div', { class: 'snapshot-summary' },
          h('div', { class: 'snapshot-title' }, project.title),
          h('div', { class: 'snapshot-meta' }, `${count.toLocaleString()} nodes · ${entry.snapshot ? 'Saved snapshot' : `Change ${entry.seq}`}`)),
        h('ol', { class: 'snapshot-tree' }, ...ordered),
        count > ordered.length ? h('div', { class: 'snapshot-more' }, `${(count - ordered.length).toLocaleString()} more nodes`) : null,
        restore,
      );
    } catch (e) { preview.replaceChildren(h('div', { class: 'history-error' }, e.message)); }
  }

  function appendEntry(entry) {
    if (shown.has(entry.seq)) return;
    shown.add(entry.seq);
    const row = h('div', { class: 'history-row' });
    const open = h('button', { class: 'history-open' },
      h('span', { class: 'history-summary' }, entry.summary),
      h('span', { class: 'history-meta' }, `#${entry.seq} · ${timeAgo(entry.at)}`));
    const badge = entry.snapshot ? h('span', { class: 'history-snapshot-badge', title: 'Saved snapshot' }, 'Snapshot') : null;
    open.onclick = () => select(entry, row);
    row.append(...[open, badge].filter(Boolean));
    rows.insertBefore(row, more);
  }
  async function loadMore() {
    if (busy || !hasMore || closed) return;
    busy = true;
    try {
      const result = await api.history(projectId, beforeSeq, 100);
      result.entries.forEach(appendEntry);
      hasMore = result.hasMore;
      beforeSeq = result.entries.at(-1)?.seq ?? beforeSeq;
      more.hidden = !hasMore;
    } catch (e) { rows.append(h('div', { class: 'history-error' }, e.message)); hasMore = false; }
    busy = false;
  }
  const more = h('button', { class: 'history-more', onclick: loadMore }, 'Load older');
  rows.append(more);
  loadMore();
  return closeModal;
}
