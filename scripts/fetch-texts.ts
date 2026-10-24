/**
 * Download the Project Gutenberg books into raw/ and write cleaned versions to public/ai/texts/.
 *
 *     node scripts/fetch-texts.ts
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {ROOT, TEXTS} from './lib.ts';

const RAW = join(ROOT, 'raw');

const NOVELS: Record<string, [id: number, firstLine: string]> = {
  pride: [1342, 'It is a truth universally'],
  holmes: [1661, 'To Sherlock Holmes she is always'],
  dracula: [345, '3 May. Bistritz'],
  moby: [2701, 'Call me Ishmael'],
};
const SHAKESPEARE_ID = 100;
const DICKENS: Record<string, number> = {
  'pickwick-papers': 580,
  'oliver-twist': 730,
  'nicholas-nickleby': 967,
  'old-curiosity-shop': 700,
  'barnaby-rudge': 917,
  'martin-chuzzlewit': 968,
  'dombey-and-son': 821,
  'david-copperfield': 766,
  'bleak-house': 1023,
  'hard-times': 786,
  'little-dorrit': 963,
  'tale-of-two-cities': 98,
  'great-expectations': 1400,
  'our-mutual-friend': 883,
  'edwin-drood': 564,
  'christmas-carol': 46,
};
const PLAYS = [
  'HAMLET',
  'MACBETH',
  'KING LEAR',
  'OTHELLO',
  'ROMEO AND JULIET',
  'MIDSUMMER',
  'TEMPEST',
  'JULIUS CAESAR',
  'MERCHANT OF VENICE',
  'MUCH ADO',
  'TWELFTH NIGHT',
  'AS YOU LIKE IT',
];

const HEADING = /^(chapter\b.*|[IVXL]+\.?|[IVXL]+\. [A-Z ,'’\-]+|THE END|Contents|ADVENTURE [IVXL]+.*)$/i;
const ALL_CAPS = /^\s*[A-Z0-9 .,'’:;\-]{4,70}$/;

const length = (s: string) => [...s].length;
const letters = (s: string) => [...s].filter(c => /\p{L}/u.test(c)).length;
const isUpper = (s: string) => s.toUpperCase() === s && s.toLowerCase() !== s;
/** Like Python's str.strip(): whitespace only, so a byte-order mark stays. */
const strip = (s: string) => s.replace(/^[^\S\uFEFF]+|[^\S\uFEFF]+$/g, '');

function indexOf(text: string, needle: string, from = 0) {
  const i = text.indexOf(needle, from);
  if (i < 0) throw new Error(`${JSON.stringify(needle)} not found`);
  return i;
}

async function download(name: string, id: number) {
  const path = join(RAW, `${name}.txt`);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), {recursive: true});
    const res = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`);
    if (!res.ok) throw new Error(`${name}: ${res.statusText}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const text = readFileSync(path, 'utf8').replaceAll('\r', '');
  const start = indexOf(text, '\n', indexOf(text, '*** START OF')) + 1;
  return text.slice(start, indexOf(text, '*** END OF'));
}

function tidy(text: string) {
  text = text.replace(/\[[^\]]*\]/g, '').replaceAll('_', '');
  return strip(text.replace(/\n{2,}/g, '\n\n')) + '\n';
}

function cleanNovel(text: string, firstLine: string) {
  text = text.slice(indexOf(text, firstLine));
  text = text.replace(/\[Illustration[^\]]*\]/g, '');
  text = text.split('CHISWICK PRESS')[0];
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const s = strip(line);
    if (length(s) < 60 && HEADING.test(s)) continue;
    if (s && s !== 'V.E.' && ALL_CAPS.test(line) && letters(s) >= 4) continue;
    lines.push(line);
  }
  return tidy(lines.join('\n'));
}

const cleanDickens = (text: string) => tidy(text.replace(/\[Illustration[^\]]*\]/g, ''));

function cleanPlays(text: string) {
  const lines = text.split('\n');
  const titles = lines
    .slice(0, 200)
    .filter(l => l.startsWith('    ') && isUpper(strip(l)) && lines.includes(strip(l)))
    .map(l => lines.indexOf(strip(l)))
    .sort((a, b) => a - b);
  const out: string[] = [];
  titles.forEach((i, k) => {
    if (!PLAYS.some(p => lines[i].includes(p))) return;
    const play = lines.slice(i, k + 1 < titles.length ? titles[k + 1] : lines.length);
    const dramatis = play.findIndex(l => l.includes('Dramatis'));
    const act1 = play.findIndex((l, j) => j >= dramatis && ['ACT I', 'ACT I.'].includes(strip(l)));
    for (const line of play.slice(act1)) {
      const s = strip(line);
      if (/^(ACT|SCENE|Scene|EPILOGUE|PROLOGUE|Enter|Exit)\b/.test(s) && length(s) < 80) continue;
      if (line.startsWith(' ') || (s && s !== 'I' && /^[A-Z][A-Z0-9 .,'’&\-]*\.?$/.test(s))) continue;
      out.push(line);
    }
  });
  return tidy(out.join('\n'));
}

mkdirSync(join(TEXTS, 'dickens'), {recursive: true});
for (const [name, [id, firstLine]] of Object.entries(NOVELS)) {
  writeFileSync(join(TEXTS, `${name}.txt`), cleanNovel(await download(name, id), firstLine));
}
writeFileSync(join(TEXTS, 'shakespeare.txt'), cleanPlays(await download('shakespeare', SHAKESPEARE_ID)));
for (const [name, id] of Object.entries(DICKENS)) {
  writeFileSync(join(TEXTS, 'dickens', `${name}.txt`), cleanDickens(await download(`dickens/${name}`, id)));
}
