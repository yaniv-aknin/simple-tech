(function () {
'use strict';

const { $, tokenize, stripBoilerplate, escapeHtml, friendly, spaceBefore, prettyJoin } = window.MK;

const SLOWEST_PER_SEC = 1, FASTEST_FLOOR_PER_SEC = 20, FASTEST_FINISHES_IN_SEC = 10, SPEED_STEPS = 14;
const WINDOW_BEFORE = 18, WINDOW_AFTER = 36, LOG_ROWS = 14, LOG_ROW_PX = 38;

const books = [];
let current = 0;
let order = 2;
let tokens = [];
let loadTicket = 0;

let pos = 0;
let hash = new Map();
let log = [];
let logSeq = 0;
let loggedSeq = 0;
let raf = null;
let lastTs = 0;
let acc = 0;
let isRunning = false;

const effectiveOrder = () => Math.max(1, Math.min(order, tokens.length - 1));
const total = () => Math.max(0, tokens.length - effectiveOrder());
/* One word per second at the slowest setting; the fastest learns the whole text in 10 seconds. */
function rate() {
  const fastest = Math.max(total() / FASTEST_FINISHES_IN_SEC, FASTEST_FLOOR_PER_SEC);
  const t = (Number($('speed').value) - 1) / (SPEED_STEPS - 1);
  return SLOWEST_PER_SEC * Math.pow(fastest / SLOWEST_PER_SEC, t);
}

/* ---------- the actual building ---------- */

function reset() {
  pos = 0;
  hash = new Map();
  log = [];
  logSeq = loggedSeq = 0;
  render();
}

function step() {
  if (pos >= total()) return false;
  const n = effectiveOrder();
  const ctx = tokens.slice(pos, pos + n);
  const next = tokens[pos + n];
  const key = ctx.join(' ');
  let entry = hash.get(key);
  if (!entry) { entry = new Map(); hash.set(key, entry); }
  const count = (entry.get(next) || 0) + 1;
  entry.set(next, count);
  log = [...log, { ctx, next, count }].slice(-LOG_ROWS);
  logSeq++;
  pos++;
  return true;
}

/* ---------- drawing ---------- */

function renderText() {
  const n = effectiveOrder();
  const cur = pos - 1;
  const from = cur < 0 ? 0 : Math.max(0, cur - WINDOW_BEFORE);
  const to = Math.min(tokens.length, cur < 0 ? WINDOW_AFTER + WINDOW_BEFORE : cur + n + 1 + WINDOW_AFTER);
  let html = '', prev = null;
  for (let i = from; i < to; i++) {
    const cls = cur < 0 ? 'ahead' : i < cur ? 'done' : i < cur + n ? 'ctx' : i === cur + n ? 'nxt' : 'ahead';
    html += (spaceBefore(prev, tokens[i]) ? ' ' : '') + `<span class="${cls}">${escapeHtml(tokens[i])}</span>`;
    prev = tokens[i];
  }
  $('text').innerHTML = html;
}

function renderTally() {
  $('progressFill').style.width = (total() ? (pos / total()) * 100 : 0) + '%';
  $('tally').innerHTML =
    `<div class="stat"><span class="num">${hash.size.toLocaleString()}</span> keys</div>` +
    `<div class="stat"><span class="num">${pos.toLocaleString()}</span> of ${total().toLocaleString()} words</div>`;
}

function renderLog() {
  const track = $('track');
  if (!log.length) {
    track.innerHTML = '<div class="log-empty">Nothing learned yet. Press Next to read the first word.</div>';
    loggedSeq = logSeq;
    return;
  }
  const fresh = logSeq - loggedSeq;
  loggedSeq = logSeq;
  track.innerHTML = log.map((row, i) =>
    `<div class="log-row${i === log.length - 1 ? ' newest' : ''}"><span class="k">${escapeHtml(prettyJoin(row.ctx))}</span>` +
    `<span class="arrow">→</span><span class="next">${friendly(row.next)}</span>` +
    `<span class="count${row.count > 1 ? ' repeat' : ''}">×${row.count}</span></div>`).join('');
  if (fresh === 1 && log.length > 1) {
    track.animate(
      [{ transform: `translateY(${LOG_ROW_PX}px)` }, { transform: 'translateY(0)' }],
      { duration: 160, easing: 'ease-out' },
    );
    track.lastElementChild.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }
}

function render() {
  $('stage').classList.toggle('editing', !!(books[current] && books[current].custom) && pos === 0 && !isRunning);
  renderText();
  renderTally();
  renderLog();
  const b = books[current];
  $('status').textContent = b && tokens.length ? `${b.title}: ${tokens.length.toLocaleString()} words and punctuation marks` : '';
}

/* ---------- running ---------- */

function setRunning(on) {
  isRunning = on;
  $('go').textContent = on ? 'Stop' : 'Start';
  $('go').classList.toggle('stop', on);
}

function stop() {
  cancelAnimationFrame(raf);
  setRunning(false);
}

function frame(ts) {
  if (!isRunning) return;
  acc += (Math.min(ts - lastTs, 100) / 1000) * rate();
  lastTs = ts;
  const n = Math.floor(acc);
  if (n > 0) {
    acc -= n;
    for (let i = 0; i < n && step(); i++);
    render();
    if (pos >= total()) { stop(); render(); return; }
  }
  raf = requestAnimationFrame(frame);
}

function start() {
  if (!tokens.length) return;
  if (pos >= total()) reset();
  cancelAnimationFrame(raf);
  setRunning(true);
  step();
  render();
  if (pos >= total()) { stop(); render(); return; }
  lastTs = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

/* ---------- books and wiring ---------- */

async function selectBook(i) {
  current = (i + books.length) % books.length;
  const ticket = ++loadTicket;
  stop();
  const b = books[current];
  MK.renderBooks($('books'), books, current, selectBook);
  tokens = [];
  reset();
  $('status').textContent = 'Reading…';
  await MK.loadText(b);
  if (ticket !== loadTicket) return;
  tokens = tokenize(stripBoilerplate(b.text));
  reset();
}

function setOrder(v) {
  order = Math.max(1, Math.min(3, v));
  $('memory').value = order;
  $('memLabel').textContent = `Remembers the last ${order} word${order > 1 ? 's' : ''}`;
  stop();
  reset();
}

$('go').addEventListener('click', () => { if (isRunning) stop(); else start(); $('go').blur(); });
$('next').addEventListener('click', () => { stop(); if (pos >= total()) reset(); step(); render(); $('next').blur(); });
$('clear').addEventListener('click', () => { stop(); reset(); $('clear').blur(); });
$('memory').addEventListener('input', (e) => setOrder(Number(e.target.value)));
$('memory').addEventListener('change', (e) => e.target.blur());
$('speed').addEventListener('change', (e) => e.target.blur());

let pasteTimer = null;
$('pasteText').addEventListener('input', () => {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    const b = books.find((x) => x.custom);
    b.text = $('pasteText').value;
    tokens = tokenize(stripBoilerplate(b.text));
    stop();
    reset();
  }, 120);
});

async function boot() {
  books.push(...await MK.loadBooks());
  setOrder(2);
  await selectBook(0);
}

boot().catch((e) => { $('status').textContent = 'Could not load the books: ' + e.message; });
})();
