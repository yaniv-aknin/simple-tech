export const OPEN = '“';
export const CLOSE = '”';
export const PUNCT = new Set(['.', ',', '!', '?', ';', ':', OPEN, CLOSE]);
export const TERMINAL = new Set(['.', '!', '?']);
export const PUNCT_NAMES: Record<string, string> = {
  '.': 'full stop',
  ',': 'comma',
  '!': '!',
  '?': '?',
  ';': 'semicolon',
  ':': 'colon',
  [OPEN]: 'open quote',
  [CLOSE]: 'close quote',
};

export function stripBoilerplate(text: string) {
  const start = text.indexOf('*** START OF');
  if (start >= 0) text = text.slice(text.indexOf('\n', start) + 1);
  const end = text.indexOf('*** END OF');
  if (end >= 0) text = text.slice(0, end);
  return text
    .split('\n')
    .filter(l => !/project gutenberg/i.test(l))
    .join('\n');
}

export function tokenize(text: string) {
  let open = true;
  text = text
    .replace(/\r/g, '')
    .replace(/_/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/—|–|--+/g, ', ')
    .replace(/"/g, () => {
      open = !open;
      return open ? CLOSE : OPEN;
    });
  const re = /(?:Mr|Mrs|Dr|St|Ms)\.|[“”]|[.,!?;:]|[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
  const out: string[] = [];
  let m;
  while ((m = re.exec(text))) {
    const t = m[0];
    const prev = out[out.length - 1];
    if (t === ',' && (prev === undefined || /^[.,!?;:]$/.test(prev))) continue;
    out.push(t);
  }
  return out;
}

export const isWord = (t: string) => !PUNCT.has(t);

export function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]!);
}

export function friendly(tok: string) {
  return PUNCT.has(tok) ? `${tok} <small>${PUNCT_NAMES[tok]}</small>` : escapeHtml(tok);
}

/* Whether a space goes before `tok` when it follows `prev` in running text. */
export function spaceBefore(prev: string | null | undefined, tok: string) {
  return prev !== null && prev !== undefined && prev !== OPEN && (!PUNCT.has(tok) || tok === OPEN);
}

export function prettyJoin(tokens: string[]) {
  let out = '';
  let prev: string | null = null;
  for (const t of tokens) {
    out += (spaceBefore(prev, t) ? ' ' : '') + t;
    prev = t;
  }
  return out;
}
