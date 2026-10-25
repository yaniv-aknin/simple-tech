import {buildPage} from '../shared/page.ts';
import './build.css';
import html from './build.html?raw';
import type {Mount} from '../../../page.ts';
import {
  escapeHtml,
  friendly,
  isWord,
  prettyJoin,
  spaceBefore,
  stripBoilerplate,
  tokenize,
} from '../../core/text.ts';
import {RESET, STEP} from '../../../ui/icons.ts';
import {loadBooks, loadText, renderBooks, type Book} from '../shared/books.ts';

const SLOWEST_PER_SEC = 1;
const FASTEST_FLOOR_PER_SEC = 20;
const FASTEST_FINISHES_IN_SEC = 10;
const SPEED_STEPS = 14;
const CHUNK = 600;
const LOG_ROWS = 60;
const LOG_ROW_PX = 26;
const MEMORY_ROWS = 10;
const TEXT_INSET = 20;
const MEMORY_REFRESH_MS = 250;

interface LogRow {
  ctx: string[];
  next: string;
  count: number;
}

export const mount: Mount = (root, signal) => {
  const {$, $input, $text, getIntParam, setParam} = buildPage(root, html);

  const books: Book[] = [];
  let current = 0;
  let order = 2;
  let tokens: string[] = [];
  let loadTicket = 0;

  let pos = 0;
  let hash = new Map<string, Map<string, number>>();
  let showPunct = false;
  let keyTotals = new Map<string, number>();
  let wordTotals = new Map<string, number>();
  let memoryShownAt = 0;
  let log: LogRow[] = [];
  let logSeq = 0;
  let loggedSeq = 0;
  let raf = 0;
  let lastTs = 0;
  let acc = 0;
  let isRunning = false;

  const effectiveOrder = () => Math.max(1, Math.min(order, tokens.length - 1));
  const total = () => Math.max(0, tokens.length - effectiveOrder());
  /* One word per second at the slowest setting; the fastest learns the whole text in 10 seconds. */
  function rate() {
    const fastest = Math.max(total() / FASTEST_FINISHES_IN_SEC, FASTEST_FLOOR_PER_SEC);
    const t = (Number($input('speed').value) - 1) / (SPEED_STEPS - 1);
    return SLOWEST_PER_SEC * Math.pow(fastest / SLOWEST_PER_SEC, t);
  }

  /* ---------- the actual building ---------- */

  function reset() {
    pos = 0;
    hash = new Map();
    keyTotals = new Map();
    wordTotals = new Map();
    memoryShownAt = 0;
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
    if (!entry) {
      entry = new Map();
      hash.set(key, entry);
    }
    const count = (entry.get(next) || 0) + 1;
    entry.set(next, count);
    keyTotals.set(key, (keyTotals.get(key) || 0) + 1);
    if (isWord(next)) wordTotals.set(key, (wordTotals.get(key) || 0) + 1);
    log = [...log, {ctx, next, count}].slice(-LOG_ROWS);
    logSeq++;
    pos++;
    return true;
  }

  /* ---------- drawing ---------- */

  let flow: HTMLElement | null = null;
  let spans: HTMLElement[] = [];
  let chunkStart = 0;
  let chunkKey = '';
  let shownCur = -1;

  const tokenClass = (i: number, cur: number, n: number) =>
    cur < 0 ? 'ahead' : i < cur ? 'done' : i < cur + n ? 'ctx' : i === cur + n ? 'nxt' : 'ahead';

  function buildFlow(cur: number, n: number) {
    chunkStart = Math.max(0, (Math.floor(Math.max(cur, 0) / CHUNK) - 1) * CHUNK);
    const to = Math.min(tokens.length, chunkStart + 3 * CHUNK);
    let html = '';
    let prev: string | null = null;
    for (let i = chunkStart; i < to; i++) {
      html +=
        (spaceBefore(prev, tokens[i]) ? ' ' : '') +
        `<span class="${tokenClass(i, cur, n)}">${escapeHtml(tokens[i])}</span>`;
      prev = tokens[i];
    }
    $('text').innerHTML = `<div class="flow">${html}</div>`;
    flow = $('text').firstElementChild as HTMLElement;
    spans = Array.from(flow.children) as HTMLElement[];
  }

  function centerMarker(cur: number, n: number, animate: boolean) {
    const marker = spans[Math.max(cur, 0) + (cur < 0 ? 0 : n) - chunkStart];
    if (!flow || !marker) return;
    /* The current line sits in the middle, once there is text above it to fill the top half. */
    const target = Math.min(
      TEXT_INSET,
      $('text').clientHeight / 2 - marker.offsetTop - marker.offsetHeight / 2,
    );
    flow.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
    flow.style.transform = `translateY(${target}px)`;
  }

  function renderText() {
    const n = effectiveOrder();
    const cur = pos - 1;
    const key = `${chunkIdentity()}:${n}:${Math.floor(Math.max(cur, 0) / CHUNK)}`;
    const rebuilt = key !== chunkKey;
    if (rebuilt) {
      chunkKey = key;
      buildFlow(cur, n);
    } else {
      const lo = Math.max(chunkStart, Math.min(cur, shownCur) - 1);
      const hi = Math.min(chunkStart + spans.length - 1, Math.max(cur, shownCur) + n + 1);
      for (let i = lo; i <= hi; i++) spans[i - chunkStart].className = tokenClass(i, cur, n);
    }
    shownCur = cur;
    centerMarker(cur, n, !rebuilt);
  }

  const chunkIdentity = () => `${current}:${tokens.length}`;

  function renderTally() {
    $('progressFill').style.width = (total() ? (pos / total()) * 100 : 0) + '%';
    $('tally').innerHTML =
      `<div class="stat"><span class="num">${hash.size.toLocaleString()}</span> keys</div>` +
      `<div class="stat"><span class="num">${pos.toLocaleString()}</span> of ${total().toLocaleString()} words</div>`;
  }

  function topKeys() {
    const top: [string, number][] = [];
    for (const entry of showPunct ? keyTotals : wordTotals) {
      if (!showPunct && !entry[0].split(' ').every(isWord)) continue;
      if (top.length === MEMORY_ROWS && entry[1] <= top[top.length - 1][1]) continue;
      let i = top.length;
      while (i > 0 && top[i - 1][1] < entry[1]) i--;
      top.splice(i, 0, entry);
      if (top.length > MEMORY_ROWS) top.pop();
    }
    return top;
  }

  function renderMemory(force: boolean) {
    const now = performance.now();
    if (!force && now - memoryShownAt < MEMORY_REFRESH_MS) return;
    memoryShownAt = now;
    $('memoryRows').innerHTML = topKeys()
      .map(([key, count]) => {
        let best = '';
        let bestCount = 0;
        for (const [word, c] of hash.get(key)!)
          if ((showPunct || isWord(word)) && c > bestCount) [best, bestCount] = [word, c];
        return (
          `<div class="log-row"><span class="k">${escapeHtml(prettyJoin(key.split(' ')))}</span>` +
          `<span class="arrow">→</span><span class="next">${friendly(best)}</span>` +
          `<span class="count">×${count}</span></div>`
        );
      })
      .join('');
  }

  function renderLog() {
    const track = $('track');
    if (!log.length) {
      track.innerHTML =
        '<div class="log-empty">Nothing learned yet. Press Next to read the first word.</div>';
      loggedSeq = logSeq;
      return;
    }
    const fresh = logSeq - loggedSeq;
    loggedSeq = logSeq;
    track.innerHTML = log
      .map(
        (row, i) =>
          `<div class="log-row${i === log.length - 1 ? ' newest' : ''}"><span class="k">${escapeHtml(prettyJoin(row.ctx))}</span>` +
          `<span class="arrow">→</span><span class="next">${friendly(row.next)}</span>` +
          `<span class="count${row.count > 1 ? ' repeat' : ''}">×${row.count}</span></div>`,
      )
      .join('');
    if (fresh === 1 && log.length > 1) {
      track.animate([{transform: `translateY(${LOG_ROW_PX}px)`}, {transform: 'translateY(0)'}], {
        duration: 160,
        easing: 'ease-out',
      });
      track.lastElementChild!.animate([{opacity: 0}, {opacity: 1}], {duration: 160, easing: 'ease-out'});
    }
  }

  function render() {
    $('stage').classList.toggle('editing', !!books[current]?.custom && pos === 0 && !isRunning);
    renderText();
    renderTally();
    renderLog();
    renderMemory(!isRunning);
    const b = books[current];
    $('status').textContent =
      b && tokens.length ? `${b.title}: ${tokens.length.toLocaleString()} words and punctuation marks` : '';
  }

  /* ---------- running ---------- */

  function setRunning(on: boolean) {
    isRunning = on;
    $('go').textContent = on ? 'Stop' : 'Start';
    $('go').classList.toggle('stop', on);
  }

  function stop() {
    cancelAnimationFrame(raf);
    setRunning(false);
  }

  function frame(ts: number) {
    if (!isRunning) return;
    acc += (Math.min(ts - lastTs, 100) / 1000) * rate();
    lastTs = ts;
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      for (let i = 0; i < n && step(); i++);
      render();
      if (pos >= total()) {
        stop();
        render();
        return;
      }
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
    if (pos >= total()) {
      stop();
      render();
      return;
    }
    lastTs = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  /* ---------- books and wiring ---------- */

  async function selectBook(i: number) {
    current = (i + books.length) % books.length;
    setParam('book', current || null);
    const ticket = ++loadTicket;
    stop();
    const b = books[current];
    renderBooks($('books'), books, current, selectBook);
    tokens = [];
    reset();
    $('status').textContent = 'Reading…';
    await loadText(b);
    if (ticket !== loadTicket) return;
    tokens = tokenize(stripBoilerplate(b.text));
    reset();
  }

  function setOrder(v: number) {
    order = Math.max(1, Math.min(3, v));
    setParam('order', order === 2 ? null : order);
    for (const b of $('memory').children)
      b.classList.toggle('on', (b as HTMLElement).dataset.n === String(order));
    stop();
    reset();
  }

  $('go').addEventListener('click', () => {
    if (isRunning) stop();
    else start();
    $('go').blur();
  });
  $('next').addEventListener('click', () => {
    stop();
    if (pos >= total()) reset();
    step();
    render();
    $('next').blur();
  });
  $('clear').addEventListener('click', () => {
    stop();
    reset();
    $('clear').blur();
  });
  window.addEventListener('resize', () => centerMarker(shownCur, effectiveOrder(), false), {signal});
  signal.addEventListener('abort', stop);
  $('punct').addEventListener('click', () => {
    showPunct = !showPunct;
    $('punct').textContent = showPunct ? 'Hide punctuation' : 'Show punctuation';
    renderMemory(true);
    $('punct').blur();
  });
  for (const b of $('memory').querySelectorAll('button'))
    b.addEventListener('click', () => {
      setOrder(Number(b.dataset.n));
      b.blur();
    });
  $('next').innerHTML = STEP;
  $('clear').innerHTML = RESET;
  $('speed').addEventListener('change', () => $('speed').blur());

  let pasteTimer = 0;
  $('pasteText').addEventListener('input', () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => {
      const b = books.find(x => x.custom)!;
      b.text = $text('pasteText').value;
      tokens = tokenize(stripBoilerplate(b.text));
      stop();
      reset();
    }, 120);
  });

  async function boot() {
    books.push(...(await loadBooks($text('pasteText'))));
    setOrder(getIntParam('order', 2));
    await selectBook(getIntParam('book', 0));
  }

  boot().catch(e => {
    $('status').textContent = 'Could not load the books: ' + e.message;
  });
};
