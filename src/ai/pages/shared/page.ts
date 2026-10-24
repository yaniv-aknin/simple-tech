import './style.css';
import './key.ts';
import {initTheme} from '../../../theme.ts';

initTheme();

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

/* Inside a slide deck's iframe, navigation keys go to the deck. */
document.addEventListener('keydown', e => {
  if (window.parent === window || !NAV_KEYS.has(e.key)) return;
  if ((e.target as Element).closest('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  window.parent.postMessage({deckKey: e.key}, '*');
});
