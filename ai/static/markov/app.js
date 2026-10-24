(function () {
'use strict';

const { $, isWord, friendly, spaceBefore, Corpus, generate } = window.MK;

/* ---------- UI state ---------- */

const books = [];
let current = 0;
let order = 2;
let running = 0;

function setEditing(on) { $('stage').classList.toggle('editing', on); }

function renderBooks() { MK.renderBooks($('books'), books, current, selectBook); }

function selectBook(i) {
  current = (i + books.length) % books.length;
  halt();
  $('status').textContent = '';
  renderBooks();
  const isCustom = !!books[current].custom;
  setEditing(isCustom);
  clearOutput('');
  resetPanel();
  if (!isCustom || books[current].text) resume(); else setRunning(false);
  if (isCustom) $('pasteText').focus();
}

async function prepare() {
  const i = current;
  const b = books[i];
  $('status').textContent = 'Reading\u2026';
  await MK.loadText(b);
  await new Promise((r) => setTimeout(r, 0));
  if (i !== current || !b.text) return;
  const t0 = performance.now();
  if (!b.corpus) b.corpus = new Corpus(b.text);
  b.corpus.model(order);
  const ms = Math.round(performance.now() - t0);
  $('status').textContent = `${b.title}: learned from ${b.corpus.wordCount.toLocaleString()} words` + (ms > 50 ? ` (${ms} ms)` : '');
}

function setOrder(v) {
  order = Math.max(1, Math.min(3, v));
  $('memory').value = order;
  $('memLabel').textContent = `Remembers the last ${order} word${order > 1 ? 's' : ''}`;
  halt();
  resume();
}

function clearOutput(msg) {
  const o = $('output');
  o.innerHTML = msg ? '<span class="placeholder"></span>' : '';
  if (msg) o.firstChild.textContent = msg;
  $('legend').classList.remove('show');
  updateClear();
}

function updateClear() {
  $('clear').classList.toggle('active', !!$('output').querySelector('.w'));
}

function resetPanel() {
  $('bars').innerHTML = '';
}

function showBars(step, corpus) {
  const bars = $('bars');
  if (!step.cands) {
    bars.innerHTML = '<div class="empty">No guessing yet.</div>';
    return;
  }
  const max = step.cands[0].p;
  const rows = step.cands.map((c) => ({ ...c, chosen: c.id === step.chosenId }));
  if (step.extra) rows.push({ ...step.extra, chosen: true, rare: true });
  bars.innerHTML = '';
  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'bar' + (r.chosen ? ' chosen' : '') + (r.rare ? ' rare' : '');
    const pct = r.p >= 0.995 ? '100%' : r.p < 0.01 ? '<1%' : Math.round(r.p * 100) + '%';
    el.innerHTML = `<div class="fill" style="width:${(r.p / max) * 100}%"></div>` +
      `<div class="txt"><span class="word">${friendly(corpus.vocab[r.id])}</span><span class="pct">${pct}</span></div>`;
    bars.appendChild(el);
  }
}

let timer = null;
let isRunning = false;

/* Slowest is one word per second, fastest 25 per second, evenly spaced on a log scale. */
const speedRate = () => Math.pow(25, (Number($('speed').value) - 1) / 13);

function setRunning(on) {
  isRunning = on;
  $('go').textContent = on ? 'Stop' : 'Start';
  $('go').classList.toggle('stop', on);
}

function halt() {
  running++;
  clearTimeout(timer);
  const latest = document.querySelector('#output .latest');
  if (latest) latest.classList.remove('latest');
}

function stop() {
  clearTimeout(timer);
  setRunning(false);
}

/* After switching book or memory: rebuild the model, then carry on if Start is active. */
let resumeTicket = 0;
async function resume() {
  const ticket = ++resumeTicket;
  await prepare();
  if (ticket === resumeTicket && isRunning) run();
}

let session = null;

function liveSession() {
  return session && session.token === running && !session.done ? session : null;
}

function newSession() {
  const c = books[current].corpus;
  if (!c || c.ids.length < 2) {
    $('status').textContent = 'Paste a little more text first (at least a couple of words).';
    setRunning(false);
    return null;
  }
  setEditing(false);
  halt();
  $('status').textContent = '';
  clearOutput('');
  session = {
    token: running,
    corpus: c,
    steps: generate(c, order, $('seed').value.trim()),
    shown: 0,
    prevTok: null,
    lastEl: null,
    done: false,
  };
  return session;
}

function advance(s) {
  const step = s.steps[s.shown++];
  showBars(step, s.corpus);
  if (s.lastEl) s.lastEl.classList.remove('latest');
  const span = document.createElement('span');
  const space = spaceBefore(s.prevTok, step.tok);
  span.textContent = (space ? ' ' : '') + step.tok;
  span.className = 'w latest' + (step.note === 'seed' ? ' given' : '');
  step.el = span;
  $('output').appendChild(span);
  updateClear();
  s.lastEl = span;
  s.prevTok = step.tok;
  if (order >= 3) markLive(s.steps, s.shown);
}

function finish(s) {
  s.done = true;
  setRunning(false);
  if (s.lastEl) s.lastEl.classList.remove('latest');
  if (order >= 3) {
    const total = s.steps.filter((x) => isWord(x.tok)).length;
    const copied = s.steps.filter((x) => x.copied && isWord(x.tok)).length;
    $('legend').classList.add('show');
    $('status').textContent = `${copied} of ${total} words (${Math.round((copied / Math.max(1, total)) * 100)}%) copied word for word from the book.`;
  }
}

function autoplay(s) {
  clearTimeout(timer);
  setRunning(true);
  const tick = () => {
    if (s.token !== running) return;
    if (s.shown >= s.steps.length) { finish(s); return; }
    advance(s);
    timer = setTimeout(tick, 1000 / speedRate());
  };
  tick();
}

/* Start: carry on with the current text if it is paused part-way, otherwise begin a new one. */
function run(fresh = false) {
  const s = (!fresh && liveSession()) || newSession();
  if (s) autoplay(s);
}

function nextWord() {
  stop();
  const s = liveSession() || newSession();
  if (!s) return;
  if (s.shown >= s.steps.length) finish(s);
  else advance(s);
}

function markLive(steps, shown) {
  for (let j = 0; j < shown; j++) {
    const s = steps[j];
    if (s.copiedAt && s.copiedAt <= shown) s.el.classList.add('copied');
  }
}

/* ---------- wiring ---------- */

$('go').addEventListener('click', () => { if (isRunning) stop(); else run(); $('go').blur(); });
$('next').addEventListener('click', () => { nextWord(); $('next').blur(); });
$('clear').addEventListener('click', () => {
  const wasRunning = isRunning;
  halt();
  setRunning(false);
  session = null;
  clearOutput('');
  resetPanel();
  $('status').textContent = '';
  setEditing(!!books[current].custom);
  if (wasRunning) run(true);
  $('clear').blur();
});
$('memory').addEventListener('input', (e) => setOrder(Number(e.target.value)));
$('memory').addEventListener('change', (e) => e.target.blur());
$('speed').addEventListener('change', (e) => e.target.blur());

let pasteTimer = null;
$('pasteText').addEventListener('input', () => {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(learnPasted, 120);
});

function learnPasted() {
  const b = books.find((x) => x.custom);
  b.text = $('pasteText').value;
  b.corpus = null;
  halt();
  setRunning(false);
  session = null;
  clearOutput('');
  resetPanel();
  if (b.text.trim()) prepare(); else $('status').textContent = '';
}

async function boot() {
  books.push(...await MK.loadBooks());
  setOrder(2);
  selectBook(0);
}

boot().catch((e) => { $('status').textContent = 'Could not load the books: ' + e.message; });
})();
