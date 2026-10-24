import {countPaths, type Option} from '../../core/gpts.ts';

/* ---------- prompt: head text, optional grid, tail text ---------- */

export interface Parts {
  head: string;
  grid: string | null;
  tail: string;
}

const GRID_LINE = /^[.#]+$/;

export function splitPrompt(prompt: string): Parts {
  const lines = prompt.split('\n');
  const first = lines.findIndex(l => GRID_LINE.test(l));
  if (first < 0) return {head: prompt, grid: null, tail: ''};
  let last = first;
  while (last + 1 < lines.length && GRID_LINE.test(lines[last + 1])) last++;
  const rows = lines.slice(first, last + 1);
  if (rows.length < 2 || rows.some(r => r.length !== rows[0].length))
    return {head: prompt, grid: null, tail: ''};
  return {
    head: lines.slice(0, first).join('\n'),
    grid: rows.join('\n'),
    tail: lines.slice(last + 1).join('\n'),
  };
}

export const joinPrompt = (parts: Parts) => [parts.head, parts.grid, parts.tail].filter(p => p).join('\n');

/* The expected answer is only known for the original question, or the original text over an edited grid. */
export function expectedAnswer(option: Option, parts: Parts) {
  if (joinPrompt(parts) === option.prompt) return option.truth ?? null;
  const original = splitPrompt(option.prompt);
  if (parts.grid && original.grid && parts.head === original.head && parts.tail === original.tail) {
    return String(countPaths(parts.grid));
  }
  return null;
}

export function isCorrect(text: string, expected: string) {
  const t = text.trim();
  return t !== '' && Number.isFinite(Number(t)) && Math.abs(Number(t) - Number(expected)) < 1e-9;
}

/** The grid as cells; clicking it calls `onClick` when given. */
export function renderMaze(grid: string, onClick?: () => void) {
  const rows = grid.split('\n');
  const maze = document.createElement('div');
  maze.className = 'maze';
  maze.style.setProperty('--cols', String(rows[0].length));
  maze.style.setProperty('--rows', String(rows.length));
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const cell = document.createElement('div');
      const end = (r === 0 && c === 0) || (r === rows.length - 1 && c === row.length - 1);
      cell.className = 'c' + (ch === '#' ? ' wall' : '') + (end ? ' end' : '');
      maze.append(cell);
    }),
  );
  if (onClick) {
    maze.title = 'Show the message as sent';
    maze.addEventListener('click', onClick);
  } else {
    maze.style.cursor = 'default';
  }
  return maze;
}
