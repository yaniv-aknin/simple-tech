(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const OPEN = '“', CLOSE = '”';
const PUNCT = new Set(['.', ',', '!', '?', ';', ':', OPEN, CLOSE]);
const TERMINAL = new Set(['.', '!', '?']);
const PUNCT_NAMES = { '.': 'full stop', ',': 'comma', '!': '!', '?': '?', ';': 'semicolon', ':': 'colon', [OPEN]: 'open quote', [CLOSE]: 'close quote' };

function stripBoilerplate(text) {
  const start = text.indexOf('*** START OF');
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.indexOf('*** END OF');
  if (end >= 0) text = text.slice(0, end);
  return text.split('\n').filter((l) => !/project gutenberg/i.test(l)).join('\n');
}

function tokenize(text) {
  let open = true;
  text = text
    .replace(/\r/g, '')
    .replace(/_/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/—|–|--+/g, ', ')
    .replace(/"/g, () => { open = !open; return open ? CLOSE : OPEN; });
  const re = /(?:Mr|Mrs|Dr|St|Ms)\.|[“”]|[.,!?;:]|[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const t = m[0];
    const prev = out[out.length - 1];
    if (t === ',' && (prev === undefined || /^[.,!?;:]$/.test(prev))) continue;
    out.push(t);
  }
  return out;
}

const isWord = (t) => !PUNCT.has(t);

function escapeHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function friendly(tok) {
  return PUNCT.has(tok) ? `${tok} <small>${PUNCT_NAMES[tok]}</small>` : escapeHtml(tok);
}

/* Whether a space goes before `tok` when it follows `prev` in running text. */
function spaceBefore(prev, tok) {
  return prev !== null && prev !== undefined && prev !== OPEN && (!PUNCT.has(tok) || tok === OPEN);
}

function prettyJoin(tokens) {
  let out = '', prev = null;
  for (const t of tokens) {
    out += (spaceBefore(prev, t) ? ' ' : '') + t;
    prev = t;
  }
  return out;
}

/* ---------- books ---------- */

async function loadBooks() {
  const list = await (await fetch('/api/books')).json();
  const books = list.map((b) => ({ ...b, emoji: b.emoji || '📖', text: '', corpus: null }));
  const custom = { title: 'Custom text', author: 'Paste anything', emoji: '✉️', text: '', corpus: null, custom: true };
  const res = await fetch('/texts/custom.txt');
  if (res.ok) {
    custom.text = await res.text();
    $('pasteText').value = custom.text;
  }
  books.push(custom);
  return books;
}

async function loadText(b) {
  if (b.text || b.custom) return;
  const res = await fetch('/texts/' + encodeURIComponent(b.file));
  b.text = await res.text();
}

function renderBooks(nav, books, current, onSelect) {
  nav.innerHTML = '';
  books.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.className = 'book' + (i === current ? ' active' : '');
    btn.innerHTML = '<span class="emoji"></span><span><span class="title"></span><span class="author"></span></span>';
    btn.querySelector('.emoji').textContent = b.emoji;
    btn.querySelector('.title').textContent = b.title;
    btn.querySelector('.author').textContent = b.author;
    btn.addEventListener('click', () => { onSelect(i); btn.blur(); });
    nav.appendChild(btn);
  });
}

window.MK = {
  $, OPEN, CLOSE, PUNCT, TERMINAL, PUNCT_NAMES,
  stripBoilerplate, tokenize, isWord, escapeHtml, friendly, spaceBefore, prettyJoin,
  loadBooks, loadText, renderBooks,
};
})();
