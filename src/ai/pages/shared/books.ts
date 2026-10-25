import type {Corpus} from '../../core/markov.ts';
import {asset} from './dom.ts';

export interface Book {
  file?: string;
  title: string;
  author: string;
  text: string;
  corpus: Corpus | null;
  custom?: boolean;
}

/** The book picker, in order. Files live in public/ai/texts/. */
const BOOKS = [
  {file: 'pride.txt', title: 'Pride and Prejudice', author: 'Jane Austen'},
  {file: 'holmes.txt', title: 'Sherlock Holmes', author: 'Arthur Conan Doyle'},
];

/** The books, the last being the custom text, which also fills `paste`. */
export async function loadBooks(paste: HTMLTextAreaElement): Promise<Book[]> {
  const books: Book[] = BOOKS.map(b => ({...b, text: '', corpus: null}));
  const custom: Book = {
    title: 'Custom text',
    author: 'Paste anything',
    text: '',
    corpus: null,
    custom: true,
  };
  const res = await fetch(asset('texts/custom.txt'));
  if (res.ok) {
    custom.text = await res.text();
    paste.value = custom.text;
  }
  books.push(custom);
  return books;
}

export async function loadText(b: Book) {
  if (b.text || b.custom) return;
  const res = await fetch(asset('texts/' + encodeURIComponent(b.file!)));
  b.text = await res.text();
}

export function renderBooks(
  nav: HTMLElement,
  books: Pick<Book, 'title' | 'author'>[],
  current: number,
  onSelect: (i: number) => void,
) {
  nav.innerHTML = '';
  books.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.className = i === current ? 'on' : '';
    btn.textContent = b.title;
    btn.title = b.author;
    btn.addEventListener('click', () => {
      onSelect(i);
      btn.blur();
    });
    nav.appendChild(btn);
  });
}
