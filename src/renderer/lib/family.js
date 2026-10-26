// Reader top bar: the parent, the current node, and the current node's children with arrows from it.
//   Parent › Current ─┬────────┐
//                     ▼        ▼
//                   Child    Child
import { h } from './dom.js';
import * as store from './store.js';
import { navigate } from '../app.js';
import { isOpenable } from './api.js';

const SVG = 'http://www.w3.org/2000/svg';

export function mountFamily(nav, projectId, nodeId) {
  const treeHash = `#/p/${projectId}`;
  const go = (n) => navigate(isOpenable(n) ? `${treeHash}/w/${n.id}` : treeHash);
  const kids = h('div', { class: 'family-kids' });
  const strip = h('div', { class: 'family-strip' });
  const arrows = document.createElementNS(SVG, 'svg');
  arrows.classList.add('family-arrows');
  arrows.setAttribute('aria-hidden', 'true');
  strip.append(arrows, kids);
  // Long child lists scroll sideways with an ordinary mouse wheel.
  strip.addEventListener('wheel', (e) => {
    if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  strip.addEventListener('scroll', () => strip.classList.toggle('overflowing', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1), { passive: true });
  const current = h('span', { class: 'crumb cur' });

  function draw() {
    const buttons = [...kids.children];
    arrows.replaceChildren();
    strip.classList.toggle('overflowing', strip.scrollWidth > strip.clientWidth + 1 && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
    if (!buttons.length) return;
    const box = strip.getBoundingClientRect();
    const width = Math.max(strip.scrollWidth, box.width);
    arrows.setAttribute('width', width);
    arrows.setAttribute('height', box.height);
    arrows.setAttribute('viewBox', `0 0 ${width} ${box.height}`);
    const mid = box.height / 2;     // the current node's text line
    const top = 9;                  // the line runs above the children
    const xs = buttons.map((b) => b.offsetLeft + Math.min(b.offsetWidth / 2, 18));
    const kidTop = buttons[0].offsetTop - 2;
    let d = `M0 ${mid} C 6 ${mid} 4 ${top} 12 ${top} H ${xs.at(-1)}`;
    for (const x of xs) d += ` M ${x} ${top} V ${kidTop - 1}`;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'family-line');
    arrows.append(path);
    for (const x of xs) {
      const head = document.createElementNS(SVG, 'path');
      head.setAttribute('d', `M ${x - 3.5} ${kidTop - 5} L ${x} ${kidTop} L ${x + 3.5} ${kidTop - 5} Z`);
      head.setAttribute('class', 'family-head');
      arrows.append(head);
    }
  }

  function render() {
    const node = store.current().nodes[nodeId];
    if (!node) return;
    const parent = node.parent != null ? store.current().nodes[node.parent] : null;
    current.textContent = node.title;
    current.title = node.title;
    const children = node.children.map((id) => store.current().nodes[id]).filter(Boolean);
    kids.replaceChildren(...children.map((c) => h('button', { class: `crumb kid ${c.type}`, title: c.title, onclick: () => go(c) }, c.title)));
    nav.replaceChildren(
      ...(parent ? [h('button', { class: `crumb parent ${parent.type}`, title: parent.title, onclick: () => go(parent) }, parent.title), h('span', { class: 'sep' }, '›')] : []),
      current,
      ...(children.length ? [strip] : []),
    );
    nav.classList.toggle('has-kids', children.length > 0);
    requestAnimationFrame(draw);
  }

  const observer = new ResizeObserver(() => draw());
  observer.observe(nav);
  render();
  return { render, dispose: () => observer.disconnect() };
}
