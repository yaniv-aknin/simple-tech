import './style.css';
import {lookup} from './dom.ts';
import {keyIcon} from './key.ts';
import {pageParams} from './params.ts';

/** Fills `root` with an AI page's markup and the key icon, and returns how to reach the page's elements and URL state. */
export function buildPage(root: HTMLElement, html: string) {
  root.innerHTML = html;
  const page = root.firstElementChild as HTMLElement;
  page.append(keyIcon);
  return {page, ...lookup(page), ...pageParams(page)};
}
