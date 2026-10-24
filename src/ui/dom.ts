export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

export function toggleOn(group: HTMLElement, isOn: (b: HTMLElement) => boolean) {
  for (const b of group.children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', isOn(b));
}
