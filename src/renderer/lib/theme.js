// Light / dark appearance. Dark is the default; the choice is kept in settings.
import { api } from './api.js';
import { h } from './dom.js';

const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5 8.5 8.5 0 1 0 20.5 14.6z"/></svg>';

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f6f6f7' : '#1c1c1e');
}

/** Sun in dark mode (switches to light), moon in light mode (switches to dark). */
export function themeButton(cls = '') {
  const btn = h('button', { class: `icon-btn theme-btn ${cls}`.trim() });
  const paint = () => {
    const light = currentTheme() === 'light';
    btn.innerHTML = light ? MOON : SUN;
    btn.title = light ? 'Dark mode' : 'Light mode';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.onclick = () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    applyTheme(next);
    api.setSetting('theme', next).catch(() => {});
    paint();
  };
  paint();
  return btn;
}

applyTheme(api.settings().theme);
