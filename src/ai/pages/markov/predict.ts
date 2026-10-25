import {buildPage} from '../shared/page.ts';
import html from './predict.html?raw';
import type {Mount} from '../../../page.ts';
import {Corpus, generate, type Step} from '../../core/markov.ts';
import {friendly, isWord, spaceBefore} from '../../core/text.ts';
import {RESET, STEP} from '../../../ui/icons.ts';
import {loadBooks, loadText, renderBooks, type Book} from '../shared/books.ts';

/* ---------- UI state ---------- */

export const mount: Mount = (root, signal) => {
  const {$, $input, $text, getIntParam, setParam} = buildPage(root, html);

  const books: Book[] = [];
  let current = 0;
  let order = 2;
  let running = 0;

  function setEditing(on: boolean) {
    $('stage').classList.toggle('editing', on);
  }

  function showBooks() {
    renderBooks($('books'), books, current, selectBook);
  }

  function selectBook(i: number) {
    current = (i + books.length) % books.length;
    setParam('book', current || null);
    halt();
    $('status').textContent = '';
    showBooks();
    const isCustom = !!books[current].custom;
    setEditing(isCustom);
    clearOutput('');
    resetPanel();
    if (!isCustom || books[current].text) resume();
    else setRunning(false);
    if (isCustom) $('pasteText').focus();
  }

  async function prepare() {
    const i = current;
    const b = books[i];
    $('status').textContent = 'Reading…';
    await loadText(b);
    await new Promise(r => setTimeout(r, 0));
    if (i !== current || !b.text) return;
    const t0 = performance.now();
    b.corpus ??= new Corpus(b.text);
    b.corpus.model(order);
    const ms = Math.round(performance.now() - t0);
    $('status').textContent =
      `${b.title}: learned from ${b.corpus.wordCount.toLocaleString()} words` +
      (ms > 50 ? ` (${ms} ms)` : '');
  }

  function setOrder(v: number) {
    order = Math.max(1, Math.min(3, v));
    setParam('order', order === 2 ? null : order);
    for (const b of $('memory').children)
      b.classList.toggle('on', (b as HTMLElement).dataset.n === String(order));
    halt();
    resume();
  }

  function clearOutput(msg: string) {
    const o = $('output');
    o.innerHTML = msg ? '<span class="placeholder"></span>' : '';
    if (msg) o.firstChild!.textContent = msg;
    $('legend').classList.remove('show');
    updateClear();
  }

  function updateClear() {
    $('clear').classList.toggle('active', !!$('output').querySelector('.w'));
  }

  function resetPanel() {
    $('bars').innerHTML = '';
  }

  function showBars(step: Step, corpus: Corpus) {
    const bars = $('bars');
    if (!step.cands) {
      bars.innerHTML = '<div class="empty">No guessing yet.</div>';
      return;
    }
    const max = step.cands[0].p;
    const rows = step.cands.map(c => ({...c, chosen: c.id === step.chosenId, rare: false}));
    if (step.extra) rows.push({...step.extra, chosen: true, rare: true});
    bars.innerHTML = '';
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = 'bar' + (r.chosen ? ' chosen' : '') + (r.rare ? ' rare' : '');
      const pct = r.p >= 0.995 ? '100%' : r.p < 0.01 ? '<1%' : Math.round(r.p * 100) + '%';
      el.innerHTML =
        `<div class="fill" style="width:${(r.p / max) * 100}%"></div>` +
        `<div class="txt"><span class="word">${friendly(corpus.vocab[r.id])}</span><span class="pct">${pct}</span></div>`;
      bars.appendChild(el);
    }
  }

  let timer = 0;
  let isRunning = false;

  /* Slowest is one word per second, fastest 25 per second, evenly spaced on a log scale. */
  const speedRate = () => Math.pow(25, (Number($input('speed').value) - 1) / 13);

  function setRunning(on: boolean) {
    isRunning = on;
    $('go').textContent = on ? 'Stop' : 'Start';
    $('go').classList.toggle('stop', on);
  }

  function halt() {
    running++;
    clearTimeout(timer);
    $('output').querySelector('.latest')?.classList.remove('latest');
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

  interface Session {
    token: number;
    corpus: Corpus;
    steps: Step[];
    els: HTMLElement[];
    shown: number;
    prevTok: string | null;
    lastEl: HTMLElement | null;
    done: boolean;
  }

  let session: Session | null = null;

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
      steps: generate(c, order, $input('seed').value.trim()),
      els: [],
      shown: 0,
      prevTok: null,
      lastEl: null,
      done: false,
    };
    return session;
  }

  function advance(s: Session) {
    const step = s.steps[s.shown++];
    showBars(step, s.corpus);
    s.lastEl?.classList.remove('latest');
    const span = document.createElement('span');
    const space = spaceBefore(s.prevTok, step.tok);
    span.textContent = (space ? ' ' : '') + step.tok;
    span.className = 'w latest' + (step.note === 'seed' ? ' given' : '');
    s.els.push(span);
    $('output').appendChild(span);
    updateClear();
    s.lastEl = span;
    s.prevTok = step.tok;
    if (order >= 3) markLive(s);
  }

  function finish(s: Session) {
    s.done = true;
    setRunning(false);
    s.lastEl?.classList.remove('latest');
    if (order >= 3) {
      const total = s.steps.filter(x => isWord(x.tok)).length;
      const copied = s.steps.filter(x => x.copied && isWord(x.tok)).length;
      $('legend').classList.add('show');
      $('status').textContent =
        `${copied} of ${total} words (${Math.round((copied / Math.max(1, total)) * 100)}%) copied word for word from the book.`;
    }
  }

  function autoplay(s: Session) {
    clearTimeout(timer);
    setRunning(true);
    const tick = () => {
      if (s.token !== running) return;
      if (s.shown >= s.steps.length) {
        finish(s);
        return;
      }
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

  function markLive(s: Session) {
    for (let j = 0; j < s.shown; j++) {
      const step = s.steps[j];
      if (step.copiedAt && step.copiedAt <= s.shown) s.els[j].classList.add('copied');
    }
  }

  /* ---------- wiring ---------- */

  $('go').addEventListener('click', () => {
    if (isRunning) stop();
    else run();
    $('go').blur();
  });
  $('next').addEventListener('click', () => {
    nextWord();
    $('next').blur();
  });
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
  for (const b of $('memory').querySelectorAll('button'))
    b.addEventListener('click', () => {
      setOrder(Number(b.dataset.n));
      b.blur();
    });
  $('next').innerHTML = STEP;
  $('clear').innerHTML = RESET;
  $('speed').addEventListener('change', () => $('speed').blur());
  signal.addEventListener('abort', stop);

  let pasteTimer = 0;
  $('pasteText').addEventListener('input', () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(learnPasted, 120);
  });

  function learnPasted() {
    const b = books.find(x => x.custom)!;
    b.text = $text('pasteText').value;
    b.corpus = null;
    halt();
    setRunning(false);
    session = null;
    clearOutput('');
    resetPanel();
    if (b.text.trim()) prepare();
    else $('status').textContent = '';
  }

  async function boot() {
    books.push(...(await loadBooks($text('pasteText'))));
    setOrder(getIntParam('order', 2));
    selectBook(getIntParam('book', 0));
  }

  boot().catch(e => {
    $('status').textContent = 'Could not load the books: ' + e.message;
  });
};
