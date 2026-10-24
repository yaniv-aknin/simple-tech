import '../shared/page.ts';
import './gpts.css';
import './tools.css';
import './context.css';
import {
  AGENT_SPEEDUP,
  LIMIT_TOKENS,
  QUESTIONS,
  bookInfos,
  recordingKey,
  replay,
  runLive,
  type BookInfo,
  type ContextData,
  type Event,
  type IndexMeta,
  type Library,
  type Method,
  type Scope,
} from '../../core/context.ts';
import {speedOf} from '../../core/gpts.ts';
import {$, asset, el, fetchJson} from '../shared/dom.ts';
import {livePost} from '../shared/key.ts';
import {getParam, setParam} from '../shared/params.ts';

const METER_MAX = 6_000_000;
const fmt = (n: number) => n.toLocaleString('en-US');
const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k');

interface Run {
  body: HTMLElement;
  metrics: {tokens: string; calls: string; time: string};
  status: HTMLElement | null;
}

const once = <T>(load: () => Promise<T>) => {
  let value: Promise<T> | null = null;
  return () => (value ??= load());
};

const texts: Record<string, Promise<string>> = {};
const library: Library = {
  text: slug => (texts[slug] ??= fetch(asset(`texts/dickens/${slug}.txt`)).then(r => r.text())),
  vectors: once(() =>
    fetch(asset('data/dickens.vec'))
      .then(r => r.arrayBuffer())
      .then(b => new Float32Array(b)),
  ),
  meta: once(() => fetchJson<IndexMeta>('data/dickens_index.json')),
};

let books: BookInfo[];
let recordings: ContextData;
let book = '';
let scope: Scope = 'book';
const runs: Partial<Record<Method, Run>> = {};

const bookInfo = (slug: string) => books.find(b => b.slug === slug)!;
const totalTokens = () => books.reduce((sum, b) => sum + b.tokens, 0);

/* ---------- meter ---------- */

function showMeter(tokens: number) {
  const over = tokens > LIMIT_TOKENS;
  $('fill').style.width = Math.min(100, (tokens / METER_MAX) * 100) + '%';
  $('fill').classList.toggle('over', over);
  $('meterTokens').textContent = `${fmt(tokens)} tokens`;
}

function resetMeter() {
  $('window').style.width = (LIMIT_TOKENS / METER_MAX) * 100 + '%';
  $('meterLimit').textContent = `limit ${fmt(LIMIT_TOKENS)}`;
  showMeter(scope === 'all' ? totalTokens() : bookInfo(book).tokens);
}

/* ---------- metrics ---------- */

function renderMetrics(method: Method, {tokens, calls, time}: Run['metrics']) {
  const box = $(method + 'Metrics');
  box.replaceChildren();
  for (const [label, value] of [
    ['tokens', tokens],
    ['calls', calls],
    ['time', time],
  ]) {
    const cell = el('div', '', label);
    cell.prepend(el('b', '', value));
    box.append(cell);
  }
}

function emptyMetrics(method: Method) {
  renderMetrics(method, {tokens: '–', calls: '–', time: '–'});
}

/* ---------- runs ---------- */

const handlers: Record<Method, (ev: Event, run: Run) => void> = {
  stuff(ev, run) {
    if (ev.type === 'start') {
      showMeter(ev.tokens);
      run.status = run.body.appendChild(
        el('div', 'line pending', `Sending ${fmt(ev.tokens)} tokens to GPT6 Luna`),
      );
    } else if (ev.type === 'error') {
      run.status?.classList.remove('pending');
      run.body.append(el('div', 'fail', ev.message));
      run.metrics.tokens = '0';
    } else if (ev.type === 'answer') {
      run.status!.classList.remove('pending');
      run.body.append(el('div', 'answer', ev.text));
      run.metrics.tokens = fmt(ev.prompt_tokens + ev.completion_tokens);
      run.metrics.calls = String(ev.calls);
    }
  },
  rag(ev, run) {
    if (ev.type === 'embedding') {
      run.status = run.body.appendChild(
        el('div', 'line pending', 'Embedding the question and searching the chunks'),
      );
    } else if (ev.type === 'retrieved') {
      const status = run.status!;
      status.classList.remove('pending');
      status.textContent = `Searched ${fmt(ev.searched)} passages in ${ev.ms} ms. Best ${ev.per_book} from each of ${ev.chunks.length / ev.per_book} novels:`;
      status.before(el('div', 'query', ev.query));
      const scores: number[] = ev.chunks
        .flatMap((c: Event) => c.sentences.map((s: Event) => s.score))
        .sort((a: number, b: number) => a - b);
      const low = scores[Math.floor(scores.length / 2)];
      const high = scores[scores.length - 1];
      for (const c of ev.chunks) {
        const card = el('div', 'chunk');
        const head = el('div', 'ch', c.book);
        head.append(el('span', 'score', c.score.toFixed(3)));
        const text = el('div', 'ct');
        for (const s of c.sentences) {
          const hit = Math.max(0, (s.score - low) / (high - low)) ** 2;
          const span = el('span', hit > 0.02 ? 'hit' : '', s.text + ' ');
          span.style.setProperty('--hit', hit.toFixed(2));
          text.append(span);
        }
        card.append(head, text);
        card.addEventListener('click', () => card.classList.toggle('open'));
        run.body.append(card);
      }
      run.status = run.body.appendChild(
        el('div', 'line pending', `Asking GPT6 Luna with those ${ev.chunks.length} chunks`),
      );
      scrollToEnd(run.body);
    } else if (ev.type === 'answer') {
      run.status!.classList.remove('pending');
      run.body.append(el('div', 'answer', ev.text));
      run.metrics.tokens = fmt(ev.prompt_tokens + ev.completion_tokens);
      run.metrics.calls = String(ev.calls);
      scrollToEnd(run.body);
    } else if (ev.type === 'error') {
      run.status?.classList.remove('pending');
      run.body.append(el('div', 'fail', ev.message));
    }
  },
  agents(ev, run) {
    if (ev.type === 'plan') {
      $('tiles').replaceChildren();
      for (const b of ev.books) {
        const tile = el('div', 'tile');
        tile.dataset.slug = b.slug;
        tile.append(el('span', 'tn', b.title), el('span', 'ts', `${compact(b.tokens)} tokens`));
        tile.addEventListener('click', () => showNote(tile));
        $('tiles').append(tile);
      }
    } else if (ev.type === 'agent') {
      const tile = $('tiles').querySelector<HTMLElement>(`[data-slug="${ev.slug}"]`)!;
      const ts = tile.querySelector('.ts')!;
      tile.classList.remove('running', 'done', 'err');
      if (ev.state === 'start') {
        tile.classList.add('running');
        ts.textContent = 'reading';
      } else if (ev.state === 'done') {
        tile.classList.add('done');
        ts.textContent = `✓ ${compact(ev.prompt_tokens)}`;
        tile.dataset.note = ev.text;
      } else {
        tile.classList.add('err');
        ts.textContent = 'failed';
        tile.dataset.note = ev.message;
      }
    } else if (ev.type === 'synthesis') {
      run.status = run.body.appendChild(el('div', 'line pending', 'Synthesising the 16 notes'));
      scrollAgents();
    } else if (ev.type === 'answer') {
      run.status!.classList.remove('pending');
      run.body.append(el('div', 'answer', ev.text));
      run.metrics.tokens = fmt(ev.total_tokens);
      run.metrics.calls = String(ev.calls);
      scrollAgents();
    } else if (ev.type === 'error') {
      run.status?.classList.remove('pending');
      run.body.append(el('div', 'fail', ev.message));
    }
  },
};

function scrollToEnd(box: HTMLElement) {
  requestAnimationFrame(() => box.scrollTo({top: box.scrollHeight, behavior: 'smooth'}));
}

const scrollAgents = () => scrollToEnd($('agentsScroll'));

function showNote(tile: HTMLElement) {
  if (!tile.dataset.note) return;
  for (const t of $('tiles').children) t.classList.toggle('sel', t === tile);
  let note = $('agentsBody').querySelector('.note');
  if (!note) {
    note = el('div', 'line note');
    $('agentsBody').prepend(note);
  }
  note.textContent = `${tile.querySelector('.tn')!.textContent}: ${tile.dataset.note}`;
}

function clearColumn(method: Method) {
  $(method + 'Body').replaceChildren();
  emptyMetrics(method);
  if (method === 'agents') $('tiles').replaceChildren(...books.map(plannedTile));
}

function plannedTile(b: BookInfo) {
  const tile = el('div', 'tile');
  tile.dataset.slug = b.slug;
  tile.append(el('span', 'tn', b.title), el('span', 'ts', `${compact(b.tokens)} tokens`));
  return tile;
}

async function events(method: Method, question: string) {
  const recorded = recordings.runs[recordingKey(method, question, scope) ?? ''];
  if (recorded) {
    const speedup = AGENT_SPEEDUP[method] ?? 1;
    return {speedup, events: replay(recorded.events, speedOf(recordings) * speedup)};
  }
  return {speedup: 1, events: runLive(await livePost(), library, method, question, scope, book)};
}

async function run(method: Method) {
  if (runs[method]) return;
  const question = $<HTMLTextAreaElement>('question').value.trim();
  if (!question) return;
  clearColumn(method);
  const button = document.querySelector<HTMLButtonElement>(`.run[data-method="${method}"]`)!;
  button.disabled = true;
  const state: Run = {
    body: $(method + 'Body'),
    metrics: {tokens: '–', calls: '–', time: '0.0s'},
    status: null,
  };
  let speedup = 1;
  runs[method] = state;
  const started = performance.now();
  const tick = () => {
    state.metrics.time = (((performance.now() - started) / 1000) * speedup).toFixed(1) + 's';
    renderMetrics(method, state.metrics);
  };
  const timer = setInterval(tick, 100);
  try {
    const stream = await events(method, question);
    speedup = stream.speedup;
    for await (const ev of stream.events) handlers[method](ev, state);
  } catch (e) {
    state.body.append(el('div', 'fail', (e as Error).message));
  } finally {
    clearInterval(timer);
    tick();
    delete runs[method];
    button.disabled = false;
  }
}

/* ---------- wiring ---------- */

function selectPreset(preset: (typeof QUESTIONS)[number]) {
  setParam('preset', preset === QUESTIONS[0] ? null : preset.id);
  $<HTMLTextAreaElement>('question').value = preset.text;
  book = preset.book;
  $('scopeBook').textContent = bookInfo(book).title;
  resetMeter();
  autosize();
}

function autosize() {
  const q = $('question');
  q.style.height = 'auto';
  q.style.height = q.scrollHeight + 'px';
}

function reset() {
  for (const method of ['stuff', 'rag', 'agents'] as const) clearColumn(method);
  resetMeter();
}

async function init() {
  [books, recordings] = await Promise.all([
    library.meta().then(bookInfos),
    fetchJson<ContextData>('data/context.json'),
  ]);
  $('meterLimit').textContent = `limit ${fmt(LIMIT_TOKENS)}`;
  $('agentsSpeed').textContent = `${AGENT_SPEEDUP.agents}x speed`;
  const labels: Record<string, string> = {'poor-rich': 'Poor vs rich', barkis: 'Barkis'};
  const initial = QUESTIONS.find(q => q.id === getParam('preset')) ?? QUESTIONS[0];
  QUESTIONS.forEach(preset => {
    const button = el('button', '', labels[preset.id] || preset.id);
    button.addEventListener('click', () => {
      selectPreset(preset);
      button.blur();
    });
    $('presets').append(button);
    if (preset === initial) selectPreset(preset);
  });
  reset();
  document.querySelectorAll<HTMLElement>('.run').forEach(b =>
    b.addEventListener('click', () => {
      run(b.dataset.method as Method);
      b.blur();
    }),
  );
  $('scope').addEventListener('click', e => {
    const button = (e.target as Element).closest('button');
    if (!button) return;
    scope = button.dataset.scope as Scope;
    for (const b of $('scope').children) b.classList.toggle('on', b === button);
    resetMeter();
    button.blur();
  });
  $('question').addEventListener('input', autosize);
  $('reset').addEventListener('click', () => {
    reset();
    $('reset').blur();
  });
}

init();
