import './standalone.css';
import type {Mount} from './page.ts';
import {initTheme} from './theme.ts';

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

/** Shows a page on its own, outside the shell, as slide decks embed them. */
export function standalone(mount: Mount) {
  initTheme();
  const root = Object.assign(document.createElement('div'), {className: 'page'});
  document.body.append(root);
  mount(root, new AbortController().signal);
}

/* Inside a slide deck's iframe, navigation keys go to the deck. */
document.addEventListener('keydown', e => {
  if (window.parent === window || !NAV_KEYS.has(e.key)) return;
  if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  window.parent.postMessage({deckKey: e.key}, '*');
});
