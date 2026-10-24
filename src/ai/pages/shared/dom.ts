/**
 * Finds a page's elements by id. The search stays within `page`, so work that finishes after the page was left
 * only changes its own detached elements.
 */
export function lookup(page: HTMLElement) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const node = page.querySelector<T>('#' + id);
    if (!node) throw new Error(`#${id} not found`);
    return node;
  };
  return {
    $,
    $input: (id: string) => $<HTMLInputElement>(id),
    $text: (id: string) => $<HTMLTextAreaElement>(id),
  };
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** URL of a file under public/ai/, wherever the site is deployed. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}ai/${path}`;

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`${path}: ${res.statusText}`);
  return res.json();
}
