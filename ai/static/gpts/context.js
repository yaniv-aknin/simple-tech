(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const METER_MAX = 6_000_000;
const fmt = (n) => n.toLocaleString('en-US');
const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k');

let config = null;
let book = null;
let scope = 'book';
const runs = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const bookInfo = (slug) => config.books.find((b) => b.slug === slug);
const totalTokens = () => config.books.reduce((sum, b) => sum + b.tokens, 0);

/* ---------- meter ---------- */

function showMeter(tokens) {
  const over = tokens > config.limit;
  $('fill').style.width = Math.min(100, (tokens / METER_MAX) * 100) + '%';
  $('fill').classList.toggle('over', over);
  $('meterTokens').textContent = `${fmt(tokens)} tokens`;
}

function resetMeter() {
  $('window').style.width = (config.limit / METER_MAX) * 100 + '%';
  $('meterLimit').textContent = `limit ${fmt(config.limit)}`;
  showMeter(scope === 'all' ? totalTokens() : bookInfo(book).tokens);
}

/* ---------- metrics ---------- */

function renderMetrics(method, { tokens, calls, time }) {
  const box = $(method + 'Metrics');
  box.replaceChildren();
  for (const [label, value] of [['tokens', tokens], ['calls', calls], ['time', time]]) {
    const cell = el('div', '', label);
    cell.prepend(el('b', '', value));
    box.append(cell);
  }
}

function emptyMetrics(method) {
  renderMetrics(method, { tokens: '–', calls: '–', time: '–' });
}

/* ---------- runs ---------- */

const handlers = {
  stuff(ev, run) {
    if (ev.type === 'start') {
      showMeter(ev.tokens);
      run.status = run.body.appendChild(el('div', 'line pending', `Sending ${fmt(ev.tokens)} tokens to GPT6 Luna`));
    } else if (ev.type === 'error') {
      run.status?.classList.remove('pending');
      run.body.append(el('div', 'fail', ev.message));
      run.metrics.tokens = '0';
    } else if (ev.type === 'answer') {
      run.status.classList.remove('pending');
      run.body.append(el('div', 'answer', ev.text));
      run.metrics.tokens = fmt(ev.prompt_tokens + ev.completion_tokens);
      run.metrics.calls = String(ev.calls);
    }
  },
  rag(ev, run) {
    if (ev.type === 'embedding') {
      run.status = run.body.appendChild(el('div', 'line pending', 'Embedding the question and searching the chunks'));
    } else if (ev.type === 'retrieved') {
      run.status.classList.remove('pending');
      run.status.textContent = `Searched ${fmt(ev.searched)} passages in ${ev.ms} ms. Best ${ev.per_book} from each of ${ev.chunks.length / ev.per_book} novels:`;
      run.status.before(el('div', 'query', ev.query));
      const scores = ev.chunks.flatMap((c) => c.sentences.map((s) => s.score)).sort((a, b) => a - b);
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
      run.status = run.body.appendChild(el('div', 'line pending', `Asking GPT6 Luna with those ${ev.chunks.length} chunks`));
      scrollToEnd(run.body);
    } else if (ev.type === 'answer') {
      run.status.classList.remove('pending');
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
      const tile = $('tiles').querySelector(`[data-slug="${ev.slug}"]`);
      tile.classList.remove('running', 'done', 'err');
      if (ev.state === 'start') {
        tile.classList.add('running');
        tile.querySelector('.ts').textContent = 'reading';
      } else if (ev.state === 'done') {
        tile.classList.add('done');
        tile.querySelector('.ts').textContent = `✓ ${compact(ev.prompt_tokens)}`;
        tile.dataset.note = ev.text;
      } else {
        tile.classList.add('err');
        tile.querySelector('.ts').textContent = 'failed';
        tile.dataset.note = ev.message;
      }
    } else if (ev.type === 'synthesis') {
      run.status = run.body.appendChild(el('div', 'line pending', 'Synthesising the 16 notes'));
      scrollAgents();
    } else if (ev.type === 'answer') {
      run.status.classList.remove('pending');
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

function scrollToEnd(box) {
  requestAnimationFrame(() => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }));
}

const scrollAgents = () => scrollToEnd($('agentsScroll'));

function showNote(tile) {
  if (!tile.dataset.note) return;
  for (const t of $('tiles').children) t.classList.toggle('sel', t === tile);
  let note = $('agentsBody').querySelector('.note');
  if (!note) {
    note = el('div', 'line note');
    $('agentsBody').prepend(note);
  }
  note.textContent = `${tile.querySelector('.tn').textContent}: ${tile.dataset.note}`;
}

function clearColumn(method) {
  $(method + 'Body').replaceChildren();
  emptyMetrics(method);
  if (method === 'agents') $('tiles').replaceChildren(...config.books.map(plannedTile));
}

function plannedTile(b) {
  const tile = el('div', 'tile');
  tile.dataset.slug = b.slug;
  tile.append(el('span', 'tn', b.title), el('span', 'ts', `${compact(b.tokens)} tokens`));
  return tile;
}

async function run(method) {
  if (runs[method]) return;
  const question = $('question').value.trim();
  if (!question) return;
  clearColumn(method);
  const button = document.querySelector(`.run[data-method="${method}"]`);
  button.disabled = true;
  const state = { body: $(method + 'Body'), metrics: { tokens: '–', calls: '–', time: '0.0s' }, status: null };
  let speedup = 1;
  runs[method] = state;
  const started = performance.now();
  const tick = () => {
    state.metrics.time = (((performance.now() - started) / 1000) * speedup).toFixed(1) + 's';
    renderMetrics(method, state.metrics);
  };
  const timer = setInterval(tick, 100);
  try {
    const res = await fetch('/api/context/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, question, scope, book }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    speedup = Number(res.headers.get('X-Speedup')) || 1;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) handlers[method](JSON.parse(line), state);
    }
  } catch (e) {
    state.body.append(el('div', 'fail', e.message));
  } finally {
    clearInterval(timer);
    tick();
    delete runs[method];
    button.disabled = false;
  }
}

/* ---------- wiring ---------- */

function selectPreset(preset) {
  $('question').value = preset.text;
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
  for (const method of ['stuff', 'rag', 'agents']) clearColumn(method);
  resetMeter();
}

async function init() {
  config = await (await fetch('/api/context')).json();
  $('meterLimit').textContent = `limit ${fmt(config.limit)}`;
  $('agentsSpeed').textContent = `${config.speedup.agents}x speed`;
  const labels = { 'poor-rich': 'Poor vs rich', barkis: 'Barkis' };
  config.questions.forEach((preset, i) => {
    const button = el('button', '', labels[preset.id] || preset.id);
    button.addEventListener('click', () => { selectPreset(preset); button.blur(); });
    $('presets').append(button);
    if (i === 0) selectPreset(preset);
  });
  reset();
  document.querySelectorAll('.run').forEach((b) => b.addEventListener('click', () => { run(b.dataset.method); b.blur(); }));
  $('scope').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    scope = button.dataset.scope;
    for (const b of $('scope').children) b.classList.toggle('on', b === button);
    resetMeter();
    button.blur();
  });
  $('question').addEventListener('input', autosize);
  $('reset').addEventListener('click', () => { reset(); $('reset').blur(); });
}

init();
})();
