(function () {
'use strict';

const { $, renderBooks } = window.MK;
const task = document.body.dataset.task;

let config = null;
let current = 0;
let parts = null;
let token = 0;

const option = () => config.options[current];
const corpora = {};

/* ---------- prompt: head text, optional grid, tail text ---------- */

const GRID_LINE = /^[.#]+$/;

function splitPrompt(prompt) {
  const lines = prompt.split('\n');
  const first = lines.findIndex((l) => GRID_LINE.test(l));
  if (first < 0) return { head: prompt, grid: null, tail: '' };
  let last = first;
  while (last + 1 < lines.length && GRID_LINE.test(lines[last + 1])) last++;
  const rows = lines.slice(first, last + 1);
  if (rows.length < 2 || rows.some((r) => r.length !== rows[0].length)) return { head: prompt, grid: null, tail: '' };
  return { head: lines.slice(0, first).join('\n'), grid: rows.join('\n'), tail: lines.slice(last + 1).join('\n') };
}

const composePrompt = () => [parts.head, parts.grid, parts.tail].filter((p) => p).join('\n');
const isCollapsed = () => parts.grid === null && composePrompt().length > 500;
const isEdited = () => composePrompt() !== option().prompt;

function countPaths(grid) {
  const rows = grid.split('\n');
  const ways = rows.map((row) => Array(row.length).fill(0));
  ways[0][0] = 1;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '.' && (r || c)) ways[r][c] = (r ? ways[r - 1][c] : 0) + (c ? ways[r][c - 1] : 0);
  }));
  return ways[rows.length - 1][rows[0].length - 1];
}

/* The expected answer is only known for the original question, or the original text over an edited grid. */
function truth() {
  if (!isEdited()) return option().truth ?? null;
  const original = splitPrompt(option().prompt);
  if (parts.grid && original.grid && parts.head === original.head && parts.tail === original.tail) return String(countPaths(parts.grid));
  return null;
}

function isCorrect(text, expected) {
  const t = text.trim();
  return t !== '' && Number.isFinite(Number(t)) && Math.abs(Number(t) - Number(expected)) < 1e-9;
}

/* ---------- rendering ---------- */

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function renderMaze(grid) {
  const rows = grid.split('\n');
  const maze = document.createElement('div');
  maze.className = 'maze';
  maze.title = 'Show the message as sent';
  maze.style.setProperty('--cols', rows[0].length);
  maze.style.setProperty('--rows', rows.length);
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const cell = document.createElement('div');
    const end = r === 0 && c === 0 || r === rows.length - 1 && c === row.length - 1;
    cell.className = 'c' + (ch === '#' ? ' wall' : '') + (end ? ' end' : '');
    maze.append(cell);
  }));
  maze.addEventListener('click', openModal);
  return maze;
}

/* Compact options show line breaks as " / " so they take one line. */
const LINE_BREAK = ' / ';
const toShown = (text) => (option().compact ? text.replaceAll('\n', LINE_BREAK) : text);
const fromShown = (text) => (option().compact ? text.replaceAll(LINE_BREAK, '\n') : text);

function field(key) {
  const el = document.createElement('textarea');
  el.rows = 1;
  el.spellcheck = false;
  el.value = toShown(parts[key]);
  el.addEventListener('input', () => { parts[key] = fromShown(el.value); autosize(el); edited(); });
  return el;
}

function renderPreview() {
  const paragraphs = composePrompt().split(/\n\s*\n/);
  const hidden = Math.max(0, paragraphs.length - 2);
  const preview = document.createElement('div');
  preview.className = 'preview';
  const first = document.createElement('span');
  first.className = 'first';
  first.textContent = paragraphs[0].split(/(?<=[.!?])\s/)[0];
  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = hidden ? `[${hidden} more paragraph${hidden > 1 ? 's' : ''}]` : '[read in full]';
  more.addEventListener('click', openScript);
  const last = document.createElement('span');
  last.className = 'last';
  last.textContent = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : '';
  preview.append(first, more, last);
  return preview;
}

function renderSizes() {
  const sizes = document.createElement('div');
  sizes.className = 'sizes';
  config.options.forEach((o, i) => {
    const button = document.createElement('button');
    button.textContent = `${o.id}×${o.id}`;
    button.classList.toggle('on', i === current);
    button.addEventListener('click', () => selectOption(i));
    sizes.append(button);
  });
  return sizes;
}

function renderPrompt() {
  const box = $('prompt');
  box.innerHTML = '';
  const q = document.createElement('div');
  q.className = 'q';
  if (isCollapsed()) {
    q.append(renderPreview());
  } else {
    q.append(field('head'));
    if (parts.grid !== null) q.append(field('tail'));
  }
  box.append(q);
  if (parts.grid !== null) box.append(renderMaze(parts.grid));
  const side = document.createElement('div');
  side.className = 'side';
  const truthBox = document.createElement('div');
  truthBox.className = 'truth';
  truthBox.id = 'truth';
  side.append(truthBox);
  if (!$('books') && config.options.length > 1) side.append(renderSizes());
  box.append(side);
  renderTruth();
  q.querySelectorAll('textarea').forEach(autosize);
  renderMode();
}

function renderTruth() {
  const t = truth();
  const box = $('truth');
  box.hidden = t === null;
  box.innerHTML = 'Correct answer<b></b>';
  if (t !== null) box.querySelector('b').textContent = t;
}

function renderMode() {
  const mode = $('mode');
  mode.className = 'mode';
  mode.textContent = '';
  if (isEdited()) {
    const reset = document.createElement('button');
    reset.textContent = 'reset';
    reset.addEventListener('click', () => { loadOption(); });
    mode.append(reset);
  }
}

function edited() {
  token++;
  renderResults();
  renderTruth();
  renderMode();
}

function renderResults() {
  const results = $('results');
  results.innerHTML = '';
  results.style.setProperty('--cols', option().models.length);
  for (const m of option().models) {
    const col = document.createElement('div');
    col.className = 'model';
    col.innerHTML = '<div class="mhead"><span class="mname"></span><span class="msub"></span><span class="score"></span></div><div class="runs"></div>';
    col.querySelector('.mname').textContent = m.name;
    col.querySelector('.msub').textContent = m.sub;
    const runs = col.querySelector('.runs');
    runs.style.setProperty('--runs', m.runs.length);
    for (let r = 0; r < m.runs.length; r++) {
      runs.insertAdjacentHTML('beforeend', `<div class="run"><span class="n">${r + 1}</span><span class="ans"></span></div>`);
    }
    results.append(col);
  }
}

const runEl = (mi, run) => $('results').children[mi].querySelectorAll('.run')[run];

function formatAnswer(raw) {
  const text = raw.trim();
  if (option().compact) return text.replace(/\s*\n+\s*/g, LINE_BREAK);
  return config.multiline ? text : text.replace(/\s+/g, ' ');
}

function showAnswer(mi, run, res) {
  const el = runEl(mi, run);
  const text = res.error ? res.error : (formatAnswer(res.text) || '(empty)');
  const expected = truth();
  el.querySelector('.ans').textContent = text;
  el.classList.remove('pending');
  el.classList.toggle('long', !config.multiline && text.length > 24);
  el.classList.toggle('multi', !!config.multiline);
  el.classList.add(res.error ? 'err' : expected === null ? 'plain' : isCorrect(res.text, expected) ? 'ok' : 'bad');
  updateScore(mi);
}

function updateScore(mi) {
  const col = $('results').children[mi];
  const right = col.querySelectorAll('.run.ok').length;
  const judged = col.querySelectorAll('.run.ok, .run.bad').length;
  col.querySelector('.score').textContent = judged ? `${right}/${judged}` : '';
}

/* ---------- running ---------- */

function postLive(model, prompt) {
  return fetch('/api/gpts/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, option: option().id, model, prompt }),
  }).then((r) => r.json()).catch((e) => ({ error: e.message }));
}

function corpusFor(file) {
  corpora[file] ??= fetch('/texts/' + file).then((r) => r.text()).then((text) => new window.MK.Corpus(text));
  return corpora[file];
}

const OFFENSIVE = /\b(fuck\w*|shit\w*|asses?|asshole\w*|pussy|bitch\w*|cunt\w*|dick\w*|cock\w*|piss\w*|bastard\w*|whore\w*|slut\w*|nigg\w*|fag\w*|retard\w*|rape\w*)\b/i;

async function markovRun(client, prompt) {
  const corpus = await corpusFor(client.corpus);
  const { generate, prettyJoin, isWord, OPEN } = window.MK;
  let text = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const tokens = generate(corpus, client.order, prompt, 45).filter((step) => step.note !== 'seed').map((step) => step.tok);
    while (tokens.length && !isWord(tokens[0]) && tokens[0] !== OPEN) tokens.shift();
    text = prettyJoin(tokens);
    if (!OFFENSIVE.test(text)) break;
  }
  return { text };
}

function start() {
  const mine = ++token;
  renderResults();
  const live = isEdited();
  const prompt = composePrompt();
  option().models.forEach((m, mi) => {
    m.runs.forEach((_, run) => runEl(mi, run).classList.add('pending'));
    const show = (run, res) => { if (mine === token) showAnswer(mi, run, res); };
    if (m.client) {
      m.runs.forEach((_, run) => markovRun(m.client, prompt).then((res) => show(run, res)));
    } else if (!live) {
      m.runs.forEach((saved, run) => {
        if (saved.missing) show(run, { error: 'No saved answer. Run scripts/refresh_gpts.py' });
        else setTimeout(() => show(run, saved), saved.latency_ms / config.speed);
      });
    } else if (m.local) {
      postLive(m.id, prompt).then((res) => m.runs.forEach((_, run) => show(run, res.error ? res : res.runs[run])));
    } else {
      m.runs.forEach((_, run) => postLive(m.id, prompt).then((res) => show(run, res)));
    }
  });
}

/* ---------- terminal mode (modal) ---------- */

function fitCode() {
  const code = $('code');
  code.style.height = 'auto';
  code.style.height = Math.min(code.scrollHeight, window.innerHeight * 0.8) + 'px';
}

function openModal() {
  $('code').value = composePrompt();
  $('modal').hidden = false;
  fitCode();
  $('code').focus();
}

function commitPrompt(text) {
  if (text === composePrompt()) return;
  parts = splitPrompt(text);
  token++;
  renderPrompt();
  renderResults();
}

function closeModal() {
  $('modal').hidden = true;
  commitPrompt($('code').value);
}

/* ---------- screenplay view ---------- */

const ACTION_WIDTH = 62;
const DIALOGUE_INDENT = 24;
const DIALOGUE_WIDTH = 36;
const CUE_INDENT = 48;

function wrapText(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const gap = /[.!?]$/.test(line) ? '  ' : ' ';
    if (line && line.length + gap.length + word.length > width) { lines.push(line); line = word; }
    else line = line ? line + gap + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

function renderScript() {
  const kinds = option().script || [];
  const view = $('scriptView');
  view.textContent = '';
  composePrompt().split(/\n\s*\n/).forEach((paragraph, i) => {
    if (i) view.append('\n\n');
    if (kinds[i] === 'voice') {
      const cue = document.createElement('b');
      cue.textContent = 'VOICE-OVER';
      view.append(' '.repeat(CUE_INDENT), cue, '\n');
      view.append(wrapText(paragraph, DIALOGUE_WIDTH).map((l) => ' '.repeat(DIALOGUE_INDENT) + l).join('\n'));
    } else {
      view.append(wrapText(paragraph, ACTION_WIDTH).join('\n'));
    }
  });
}

function showScript(editing) {
  $('scriptView').hidden = editing;
  $('scriptCode').hidden = !editing;
  $('editScript').textContent = editing ? 'Done' : 'Edit text';
  if (!editing) return;
  const code = $('scriptCode');
  code.value = composePrompt();
  code.style.height = 'auto';
  code.style.height = Math.min(code.scrollHeight, window.innerHeight * 0.78) + 'px';
  code.focus();
}

function finishScriptEdit() {
  commitPrompt($('scriptCode').value);
  renderScript();
  showScript(false);
}

function toggleScriptEdit() {
  if ($('scriptCode').hidden) showScript(true);
  else finishScriptEdit();
}

function openScript() {
  renderScript();
  showScript(false);
  $('scriptModal').hidden = false;
}

function closeScript() {
  if (!$('scriptCode').hidden) finishScriptEdit();
  $('scriptModal').hidden = true;
}

/* ---------- wiring ---------- */

function loadOption() {
  token++;
  parts = splitPrompt(option().prompt);
  renderPrompt();
  renderResults();
}

function selectOption(i) {
  current = i;
  if ($('books') && config.options.length > 1) {
    renderBooks($('books'), config.options.map((o) => ({ emoji: o.emoji, title: o.title, author: o.sub })), current, selectOption);
  }
  loadOption();
}

$('go').addEventListener('click', () => { start(); $('go').blur(); });
if ($('modal')) {
  $('closeModal').addEventListener('click', closeModal);
  $('code').addEventListener('input', fitCode);
  $('modal').addEventListener('mousedown', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });
}
if ($('scriptModal')) {
  $('closeScript').addEventListener('click', closeScript);
  $('editScript').addEventListener('click', toggleScriptEdit);
  $('scriptModal').addEventListener('mousedown', (e) => { if (e.target === $('scriptModal')) closeScript(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('scriptModal').hidden) closeScript(); });
}
window.addEventListener('resize', () => document.querySelectorAll('.prompt textarea').forEach(autosize));

fetch(`/api/gpts/${task}`)
  .then((r) => r.json())
  .then((c) => { config = c; selectOption(Math.max(0, c.options.findIndex((o) => o.default))); })
  .catch((e) => { $('mode').textContent = 'Could not load: ' + e.message; });
})();
