import './standalone.css';
import type {Mount} from './page.ts';
import {initTheme} from './theme.ts';

/** Shows a page on its own, outside the shell, as slide decks embed them. */
export function standalone(mount: Mount) {
  initTheme();
  mount(document.body, new AbortController().signal);
}
