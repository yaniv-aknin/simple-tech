(function () {
'use strict';

const { OPEN, CLOSE, TERMINAL, stripBoilerplate, tokenize, isWord } = window.MK;
const COPY_RUN = 8;

/* ---------- model ---------- */

class Corpus {
  constructor(text) {
    const toks = tokenize(stripBoilerplate(text));
    this.vocab = [];
    this.lower = new Map();
    const index = new Map();
    this.ids = new Int32Array(toks.length);
    toks.forEach((t, i) => {
      let id = index.get(t);
      if (id === undefined) {
        id = this.vocab.length;
        index.set(t, id);
        this.vocab.push(t);
        const lc = t.toLowerCase();
        if (!this.lower.has(lc)) this.lower.set(lc, []);
        this.lower.get(lc).push(id);
      }
      this.ids[i] = id;
    });
    this.wordCount = toks.filter(isWord).length;
    this.models = new Map();
    this.positions = null;
    this.gramSet = null;
    this.starts = this.findStarts();
  }

  findStarts() {
    const { ids, vocab } = this;
    const starts = [];
    for (let i = 0; i < ids.length; i++) {
      const t = vocab[ids[i]];
      let begins = i === 0;
      if (!begins) {
        const p = vocab[ids[i - 1]];
        begins = TERMINAL.has(p) || (p === CLOSE && i > 1 && TERMINAL.has(vocab[ids[i - 2]]));
      }
      if (begins && (t === OPEN || /^\p{Lu}/u.test(t))) starts.push(i);
    }
    if (!starts.length) for (let i = 0; i < ids.length; i++) starts.push(i);
    return starts;
  }

  effectiveOrder(order) {
    return Math.max(1, Math.min(order, this.ids.length - 1));
  }

  key(state, n) {
    const V = this.vocab.length;
    let k = 0;
    for (let i = 0; i < n; i++) k = k * V + state[i];
    return k;
  }

  model(order) {
    const n = this.effectiveOrder(order);
    let m = this.models.get(n);
    if (m) return m;
    m = new Map();
    const { ids } = this;
    const V = this.vocab.length;
    for (let i = 0; i + n < ids.length; i++) {
      let k = 0;
      for (let j = 0; j < n; j++) k = k * V + ids[i + j];
      const next = ids[i + n];
      const list = m.get(k);
      if (list) list.push(next); else m.set(k, [next]);
    }
    this.models.set(n, m);
    return m;
  }

  wordPositions() {
    if (!this.positions) {
      this.positions = new Map();
      for (let i = 0; i < this.ids.length; i++) {
        const l = this.positions.get(this.ids[i]);
        if (l) l.push(i); else this.positions.set(this.ids[i], [i]);
      }
    }
    return this.positions;
  }

  copiedSet() {
    if (!this.gramSet) {
      this.gramSet = new Set();
      const { ids } = this;
      for (let i = 0; i + COPY_RUN <= ids.length; i++) {
        this.gramSet.add(this.gramKey(ids, i));
      }
    }
    return this.gramSet;
  }

  gramKey(arr, at) {
    let s = '';
    for (let j = 0; j < COPY_RUN; j++) s += arr[at + j] + ',';
    return s;
  }

  candidates(list) {
    const counts = new Map();
    for (const id of list) counts.set(id, (counts.get(id) || 0) + 1);
    const total = list.length;
    return [...counts].sort((a, b) => b[1] - a[1]).map(([id, c]) => ({ id, p: c / total }));
  }

  /* Position in the corpus that best continues the seed words (longest matching tail). */
  seedPosition(seedTokens, n) {
    const words = seedTokens.filter(isWord).map((t) => t.toLowerCase());
    const pos = this.wordPositions();
    for (let back = words.length - 1; back >= 0; back--) {
      const ids = this.lower.get(words[back]);
      if (!ids) continue;
      const tail = words.slice(0, back + 1);
      let best = [], bestScore = -1;
      for (const id of ids) {
        for (const p of pos.get(id) || []) {
          if (p < n - 1 || p + 1 >= this.ids.length) continue;
          let score = 0;
          while (score < tail.length && score <= p) {
            const prev = this.vocab[this.ids[p - score]];
            if (prev.toLowerCase() !== tail[tail.length - 1 - score]) break;
            score++;
          }
          if (score > bestScore) { bestScore = score; best = [p]; }
          else if (score === bestScore && best.length < 2000) best.push(p);
        }
      }
      if (best.length) return best[Math.floor(Math.random() * best.length)];
    }
    return -1;
  }
}

/* ---------- generation ---------- */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Returns a list of steps: { tok, given, cands (top-5 + chosen info), context } */
function generate(corpus, order, seedText, wordTarget) {
  const n = corpus.effectiveOrder(order);
  const model = corpus.model(n);
  const { ids, vocab } = corpus;
  const steps = [];
  const target = wordTarget ?? 60 + Math.floor(Math.random() * 61);
  let words = 0;
  let state = [];

  const push = (id, extra) => {
    steps.push({ tok: vocab[id], id, ...extra });
    state.push(id);
    if (state.length > n) state.shift();
    if (isWord(vocab[id])) words++;
  };

  const restart = () => {
    const p = pick(corpus.starts);
    const end = Math.min(p + n, ids.length);
    state = [];
    for (let i = p; i < end; i++) push(ids[i], { given: true, note: 'new' });
  };

  const seedTokens = seedText ? tokenize(seedText) : [];
  const seedPos = seedTokens.length ? corpus.seedPosition(seedTokens, n) : -1;
  if (seedPos >= 0) {
    for (const t of seedTokens) {
      steps.push({ tok: t, id: -1, given: true, note: 'seed' });
      if (isWord(t)) words++;
    }
    state = [];
    for (let i = seedPos - n + 1; i <= seedPos; i++) state.push(ids[i]);
    if (wordTarget !== undefined) words = 0;
  } else {
    restart();
  }

  const hardCap = 700;
  let overshoot = 0;
  while (steps.length < hardCap) {
    if (words >= target) {
      const last = steps[steps.length - 1].tok;
      if (TERMINAL.has(last) || overshoot++ > 40) break;
    }
    const list = model.get(corpus.key(state, state.length));
    if (!list || state.length < n) {
      const last = steps[steps.length - 1].tok;
      if (!TERMINAL.has(last)) steps.push({ tok: '.', id: -1, given: true, note: 'end' });
      restart();
      continue;
    }
    const cands = corpus.candidates(list);
    const chosenId = pick(list);
    const ctx = state.map((i) => vocab[i]);
    const top = cands.slice(0, 5);
    const inTop = top.some((c) => c.id === chosenId);
    const chosen = cands.find((c) => c.id === chosenId);
    push(chosenId, { cands: top, chosenId, extra: inTop ? null : chosen, options: cands.length, ctx });
  }

  if (n >= 3) markCopied(corpus, steps);
  return steps;
}

function markCopied(corpus, steps) {
  const set = corpus.copiedSet();
  const seq = steps.map((s) => s.id);
  for (let i = 0; i + COPY_RUN <= seq.length; i++) {
    if (seq.slice(i, i + COPY_RUN).includes(-1)) continue;
    if (set.has(corpus.gramKey(seq, i))) {
      for (let j = i; j < i + COPY_RUN; j++) {
        steps[j].copied = true;
        steps[j].copiedAt = Math.min(steps[j].copiedAt || Infinity, i + COPY_RUN);
      }
    }
  }
}

Object.assign(window.MK, { Corpus, generate });
})();
