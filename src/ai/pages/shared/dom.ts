export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node as T;
}

export const $input = (id: string) => $<HTMLInputElement>(id);
export const $text = (id: string) => $<HTMLTextAreaElement>(id);

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
