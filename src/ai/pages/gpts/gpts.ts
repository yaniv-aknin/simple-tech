import '../shared/page.ts';
import './gpts.css';
import {
  TASKS,
  entryKey,
  runLive,
  speedOf,
  taskRuns,
  type GptsData,
  type Model,
  type Option,
} from '../../core/gpts.ts';
import {Corpus, generate} from '../../core/markov.ts';
import {recordText, type Post} from '../../core/openai.ts';
import {OPEN, isWord, prettyJoin} from '../../core/text.ts';
import {renderBooks} from '../shared/books.ts';
import {$, $text, asset, fetchJson} from '../shared/dom.ts';
import {livePost} from '../shared/key.ts';
import {expectedAnswer, isCorrect, joinPrompt, renderMaze, splitPrompt, type Parts} from './prompt.ts';

interface SavedRun {
  text?: string;
  latency_ms?: number;
  missing?: boolean;
}

interface ModelView extends Model {
  runs: SavedRun[];
}

interface OptionView extends Option {
  models: ModelView[];
}

interface Result {
  text?: string;
  error?: string;
}

const task = document.body.dataset.task!;

let config: {speed: number; multiline: boolean; options: OptionView[]};
let current = 0;
let parts: Parts;
let token = 0;

const option = () => config.options[current];
const corpora: Record<string, Promise<Corpus>> = {};

function buildConfig(data: GptsData) {
  const t = TASKS[task];
  const count = taskRuns(t);
  const savedRuns = (o: Option, m: Model): SavedRun[] =>
    Array.from({length: count}, (_, run) => {
      const record = data.entries[entryKey(task, o.id, m.id, run)];
      return record ? {text: recordText(record), latency_ms: record.latency_ms} : {missing: true};
    });
  return {
    speed: speedOf(data),
    multiline: !!t.multiline,
    options: t.options.map(o => ({
      ...o,
      models: o.models.map(m => ({...m, runs: m.client ? Array(count).fill({}) : savedRuns(o, m)})),
    })),
  };
}

const composePrompt = () => joinPrompt(parts);
const isCollapsed = () => parts.grid === null && composePrompt().length > 500;
const isEdited = () => composePrompt() !== option().prompt;

const truth = () => expectedAnswer(option(), parts);

/* ---------- rendering ---------- */

function autosize(el: HTMLElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* Compact options show line breaks as " / " so they take one line. */
const LINE_BREAK = ' / ';
const toShown = (text: string) => (option().compact ? text.replaceAll('\n', LINE_BREAK) : text);
const fromShown = (text: string) => (option().compact ? text.replaceAll(LINE_BREAK, '\n') : text);

function field(key: 'head' | 'tail') {
  const el = document.createElement('textarea');
  el.rows = 1;
  el.spellcheck = false;
  el.value = toShown(parts[key]);
  el.addEventListener('input', () => {
    parts[key] = fromShown(el.value);
    autosize(el);
    edited();
  });
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
  if (parts.grid !== null) box.append(renderMaze(parts.grid, openModal));
  const side = document.createElement('div');
  side.className = 'side';
  const truthBox = document.createElement('div');
  truthBox.className = 'truth';
  truthBox.id = 'truth';
  side.append(truthBox);
  if (!document.getElementById('books') && config.options.length > 1) side.append(renderSizes());
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
  if (t !== null) box.querySelector('b')!.textContent = t;
}

function renderMode() {
  const mode = $('mode');
  mode.className = 'mode';
  mode.textContent = '';
  if (isEdited()) {
    const reset = document.createElement('button');
    reset.textContent = 'reset';
    reset.addEventListener('click', () => {
      loadOption();
    });
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
  results.style.setProperty('--cols', String(option().models.length));
  for (const m of option().models) {
    const col = document.createElement('div');
    col.className = 'model';
    col.innerHTML =
      '<div class="mhead"><span class="mname"></span><span class="msub"></span><span class="score"></span></div><div class="runs"></div>';
    col.querySelector('.mname')!.textContent = m.name;
    col.querySelector('.msub')!.textContent = m.sub;
    const runs = col.querySelector<HTMLElement>('.runs')!;
    runs.style.setProperty('--runs', String(m.runs.length));
    for (let r = 0; r < m.runs.length; r++) {
      runs.insertAdjacentHTML(
        'beforeend',
        `<div class="run"><span class="n">${r + 1}</span><span class="ans"></span></div>`,
      );
    }
    results.append(col);
  }
}

const runEl = (mi: number, run: number) => $('results').children[mi].querySelectorAll('.run')[run];

function formatAnswer(raw: string) {
  const text = raw.trim();
  if (option().compact) return text.replace(/\s*\n+\s*/g, LINE_BREAK);
  return config.multiline ? text : text.replace(/\s+/g, ' ');
}

function showAnswer(mi: number, run: number, res: Result) {
  const el = runEl(mi, run);
  const text = res.error ? res.error : formatAnswer(res.text!) || '(empty)';
  const expected = truth();
  el.querySelector('.ans')!.textContent = text;
  el.classList.remove('pending');
  el.classList.toggle('long', !config.multiline && text.length > 24);
  el.classList.toggle('multi', !!config.multiline);
  el.classList.add(
    res.error ? 'err' : expected === null ? 'plain' : isCorrect(res.text!, expected) ? 'ok' : 'bad',
  );
  updateScore(mi);
}

function updateScore(mi: number) {
  const col = $('results').children[mi];
  const right = col.querySelectorAll('.run.ok').length;
  const judged = col.querySelectorAll('.run.ok, .run.bad').length;
  col.querySelector('.score')!.textContent = judged ? `${right}/${judged}` : '';
}

/* ---------- running ---------- */

function corpusFor(file: string) {
  corpora[file] ??= fetch(asset('texts/' + file))
    .then(r => r.text())
    .then(text => new Corpus(text));
  return corpora[file];
}

const OFFENSIVE =
  /\b(fuck\w*|shit\w*|asses?|asshole\w*|pussy|bitch\w*|cunt\w*|dick\w*|cock\w*|piss\w*|bastard\w*|whore\w*|slut\w*|nigg\w*|fag\w*|retard\w*|rape\w*)\b/i;

async function markovRun(client: NonNullable<Model['client']>, prompt: string): Promise<Result> {
  const corpus = await corpusFor(client.corpus);
  let text = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const tokens = generate(corpus, client.order, prompt, 45)
      .filter(step => step.note !== 'seed')
      .map(step => step.tok);
    while (tokens.length && !isWord(tokens[0]) && tokens[0] !== OPEN) tokens.shift();
    text = prettyJoin(tokens);
    if (!OFFENSIVE.test(text)) break;
  }
  return {text};
}

const liveRun = (post: Post, m: Model, prompt: string): Promise<Result> =>
  runLive(post, task, m, prompt)
    .then(record => ({text: recordText(record)}))
    .catch(e => ({error: e.message}));

async function start() {
  const mine = ++token;
  renderResults();
  const live = isEdited();
  const prompt = composePrompt();
  const models = option().models;
  models.forEach((m, mi) => m.runs.forEach((_, run) => runEl(mi, run).classList.add('pending')));
  const show = (mi: number, run: number, res: Result) => {
    if (mine === token) showAnswer(mi, run, res);
  };
  const needsKey = (m: Model) => live && !m.client && !m.frozen;
  let post: Post | null = null;
  let keyError = '';
  if (models.some(needsKey)) {
    try {
      post = await livePost();
    } catch (e) {
      keyError = (e as Error).message;
    }
  }
  models.forEach((m, mi) => {
    if (m.client) {
      m.runs.forEach((_, run) => markovRun(m.client!, prompt).then(res => show(mi, run, res)));
    } else if (!live) {
      m.runs.forEach((saved, run) => {
        if (saved.missing) show(mi, run, {error: 'No saved answer. Run scripts/refresh-gpts.ts'});
        else setTimeout(() => show(mi, run, saved), saved.latency_ms! / config.speed);
      });
    } else if (m.frozen) {
      m.runs.forEach((_, run) => show(mi, run, {error: 'Not available live: only recorded answers exist.'}));
    } else if (post) {
      m.runs.forEach((_, run) => liveRun(post, m, prompt).then(res => show(mi, run, res)));
    } else {
      m.runs.forEach((_, run) => show(mi, run, {error: keyError}));
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
  $text('code').value = composePrompt();
  $('modal').hidden = false;
  fitCode();
  $('code').focus();
}

function commitPrompt(text: string) {
  if (text === composePrompt()) return;
  parts = splitPrompt(text);
  token++;
  renderPrompt();
  renderResults();
}

function closeModal() {
  $('modal').hidden = true;
  commitPrompt($text('code').value);
}

/* ---------- reading view ---------- */

const TEXT_WIDTH = 62;

function wrapText(text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const gap = /[.!?]$/.test(line) ? '  ' : ' ';
    if (line && line.length + gap.length + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? line + gap + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

function renderScript() {
  $('scriptView').textContent = composePrompt()
    .split(/\n\s*\n/)
    .map(paragraph => wrapText(paragraph, TEXT_WIDTH).join('\n'))
    .join('\n\n');
}

function showScript(editing: boolean) {
  $('scriptView').hidden = editing;
  $('scriptCode').hidden = !editing;
  $('editScript').textContent = editing ? 'Done' : 'Edit text';
  if (!editing) return;
  const code = $text('scriptCode');
  code.value = composePrompt();
  code.style.height = 'auto';
  code.style.height = Math.min(code.scrollHeight, window.innerHeight * 0.78) + 'px';
  code.focus();
}

function finishScriptEdit() {
  commitPrompt($text('scriptCode').value);
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

function selectOption(i: number) {
  current = i;
  const books = document.getElementById('books');
  if (books && config.options.length > 1) {
    const cards = config.options.map(o => ({emoji: o.emoji!, title: o.title!, author: o.sub!}));
    renderBooks(books, cards, current, selectOption);
  }
  loadOption();
}

$('go').addEventListener('click', () => {
  start();
  $('go').blur();
});
if (document.getElementById('modal')) {
  $('closeModal').addEventListener('click', closeModal);
  $('code').addEventListener('input', fitCode);
  $('modal').addEventListener('mousedown', e => {
    if (e.target === $('modal')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('modal').hidden) closeModal();
  });
}
if (document.getElementById('scriptModal')) {
  $('closeScript').addEventListener('click', closeScript);
  $('editScript').addEventListener('click', toggleScriptEdit);
  $('scriptModal').addEventListener('mousedown', e => {
    if (e.target === $('scriptModal')) closeScript();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('scriptModal').hidden) closeScript();
  });
}
window.addEventListener('resize', () =>
  document.querySelectorAll<HTMLElement>('.prompt textarea').forEach(autosize),
);

fetchJson<GptsData>('data/gpts.json')
  .then(data => {
    config = buildConfig(data);
    selectOption(
      Math.max(
        0,
        config.options.findIndex(o => o.default),
      ),
    );
  })
  .catch(e => {
    $('mode').textContent = 'Could not load: ' + e.message;
  });
