import {CHAT_URL, EMBEDDINGS_URL, recordText, sleep, type Post} from './openai.ts';

export const MODEL = 'gpt-6-luna';
export const EMBED_MODEL = 'text-embedding-3-small';
export const DIMS = 256;
export const EMBED_BATCH = 200;
export const LIMIT_TOKENS = 922_000;
const CHARS_PER_TOKEN = 3.85;
const CHUNK_WORDS = 150;
export const PER_BOOK = 2;
const AGENT_WORKERS = 8;
export const AGENT_SPEEDUP: Record<string, number> = {agents: 2};

export const BOOKS: [slug: string, title: string][] = [
  ['pickwick-papers', 'The Pickwick Papers'],
  ['oliver-twist', 'Oliver Twist'],
  ['nicholas-nickleby', 'Nicholas Nickleby'],
  ['old-curiosity-shop', 'The Old Curiosity Shop'],
  ['barnaby-rudge', 'Barnaby Rudge'],
  ['martin-chuzzlewit', 'Martin Chuzzlewit'],
  ['christmas-carol', 'A Christmas Carol'],
  ['dombey-and-son', 'Dombey and Son'],
  ['david-copperfield', 'David Copperfield'],
  ['bleak-house', 'Bleak House'],
  ['hard-times', 'Hard Times'],
  ['little-dorrit', 'Little Dorrit'],
  ['tale-of-two-cities', 'A Tale of Two Cities'],
  ['great-expectations', 'Great Expectations'],
  ['our-mutual-friend', 'Our Mutual Friend'],
  ['edwin-drood', 'The Mystery of Edwin Drood'],
];
export const TITLES: Record<string, string> = Object.fromEntries(BOOKS);

export const QUESTIONS = [
  {
    id: 'poor-rich',
    text: 'Explain briefly how Dickens portray the poor versus the rich?',
    book: 'bleak-house',
  },
  {
    id: 'barkis',
    text: 'In which novel does a character say "Barkis is willin\'", and what does it mean?',
    book: 'david-copperfield',
  },
];

export type Method = 'stuff' | 'rag' | 'agents';
export type Scope = 'book' | 'all';
export const METHODS: Method[] = ['stuff', 'rag', 'agents'];

const style = (words: number) => `Answer in at most ${words} words, plain text, no markdown.`;

export interface BookInfo {
  slug: string;
  title: string;
  tokens: number;
}

/** Written by `scripts/refresh-context.ts index` next to dickens.vec. */
export interface IndexMeta {
  model: string;
  dims: number;
  chunks: number;
  /** File size of each novel, for token estimates without downloading it. */
  bytes: Record<string, number>;
}

/** Where the novels and their embeddings come from: files in Node, fetches in the browser. */
export interface Library {
  text(slug: string): Promise<string>;
  vectors(): Promise<Float32Array>;
  meta(): Promise<IndexMeta>;
}

export type Event = Record<string, any> & {type: string};

export const estimateTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

export function bookInfos(meta: IndexMeta): BookInfo[] {
  return BOOKS.map(([slug, title]) => ({slug, title, tokens: estimateTokens(meta.bytes[slug])}));
}

async function labelled(library: Library, slug: string) {
  return `=== ${TITLES[slug]} ===\n${await library.text(slug)}`;
}

/** One Luna call with retries on rate limits. Returns text, token counts and latency. */
async function complete(post: Post, prompt: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const record = await post(CHAT_URL, {
        model: MODEL,
        messages: [{role: 'user', content: prompt}],
        reasoning_effort: 'low',
        max_completion_tokens: 2000,
      });
      const usage = record.response.body.usage;
      return {
        text: recordText(record),
        prompt_tokens: usage.prompt_tokens as number,
        completion_tokens: usage.completion_tokens as number,
        latency_ms: record.latency_ms,
      };
    } catch (e) {
      if (!/rate limit/i.test(String(e)) || attempt === 4) throw e;
      await sleep(15_000 * (attempt + 1));
    }
  }
}

export async function embed(post: Post, texts: string[]) {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const record = await post(EMBEDDINGS_URL, {
      model: EMBED_MODEL,
      input: texts.slice(i, i + EMBED_BATCH),
      dimensions: DIMS,
    });
    vectors.push(...record.response.body.data.map((d: {embedding: number[]}) => d.embedding));
  }
  return vectors;
}

const SENTENCE = /\S.*?[.!?]["”’']*(?=\s|$)|\S.+$/gs;
const ABBREVIATION = /\b(?:Mr|Mrs|Dr|St|Ms)\.$/;

export function sentences(text: string) {
  const out: string[] = [];
  for (const [piece] of text.matchAll(SENTENCE)) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ' ' + piece;
    else out.push(piece);
  }
  return out;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

const chunkCache = new WeakMap<Library, Promise<[slug: string, text: string][]>>();

/** (slug, text) pairs of about CHUNK_WORDS words, split on sentence boundaries. */
export function chunks(library: Library) {
  let cached = chunkCache.get(library);
  if (!cached) {
    cached = (async () => {
      const texts = await Promise.all(BOOKS.map(([slug]) => library.text(slug)));
      const out: [string, string][] = [];
      BOOKS.forEach(([slug], b) => {
        let current = '';
        let words = 0;
        for (const paragraph of texts[b].split(/\n\s*\n/)) {
          sentences(paragraph.trim()).forEach((sentence, i) => {
            current += (!current ? '' : i === 0 ? '\n\n' : ' ') + sentence;
            words += wordCount(sentence);
            if (words >= CHUNK_WORDS) {
              out.push([slug, current]);
              current = '';
              words = 0;
            }
          });
        }
        if (current) out.push([slug, current]);
      });
      return out;
    })();
    chunkCache.set(library, cached);
  }
  return cached;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>, offset = 0) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[offset + i];
  return sum;
};

/** The best `perBook` passages of each novel, in book order, as [score, chunk index]. */
async function search(library: Library, query: number[], perBook: number) {
  const [all, meta, data] = await Promise.all([chunks(library), library.meta(), library.vectors()]);
  if (meta.chunks !== all.length || meta.dims !== DIMS) {
    throw new Error('dickens.vec is out of date; run scripts/refresh-context.ts index');
  }
  const best: Record<string, [number, number][]> = Object.fromEntries(BOOKS.map(([slug]) => [slug, []]));
  all.forEach(([slug], i) => best[slug].push([dot(query, data, i * DIMS), i]));
  const descending = (a: [number, number], b: [number, number]) => b[0] - a[0] || b[1] - a[1];
  return BOOKS.flatMap(([slug]) => best[slug].sort(descending).slice(0, perBook));
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

async function* runStuff(post: Post, library: Library, question: string, scope: Scope, book: string) {
  const slugs = scope === 'all' ? BOOKS.map(([slug]) => slug) : [book];
  const text = (await Promise.all(slugs.map(slug => labelled(library, slug)))).join('\n\n');
  const tokens = estimateTokens(text.length);
  yield {type: 'start', tokens, books: slugs.length};
  if (tokens > LIMIT_TOKENS) {
    const fmt = (n: number) => n.toLocaleString('en-US');
    yield {
      type: 'error',
      message: `Input is about ${fmt(tokens)} tokens; the model accepts at most ${fmt(LIMIT_TOKENS)}. Request not sent.`,
    };
    return;
  }
  try {
    const result = await complete(post, `${text}\n\n---\n${question}\n${style(120)}`);
    yield {type: 'answer', ...result, calls: 1};
  } catch (e) {
    yield {type: 'error', message: (e as Error).message};
  }
}

/** Second embedding pass: score every sentence of the retrieved passages against the question. */
async function sentenceScores(post: Post, query: number[], texts: string[]) {
  const pieces = texts.map(sentences);
  const flat = await embed(post, pieces.flat());
  let k = 0;
  return pieces.map(piece => piece.map(text => ({text, score: round3(dot(query, flat[k++]))})));
}

async function* runRag(post: Post, library: Library, question: string) {
  yield {type: 'embedding', query: question};
  const started = performance.now();
  const [query] = await embed(post, [question]);
  const hits = await search(library, query, PER_BOOK);
  const all = await chunks(library);
  const ms = Math.round(performance.now() - started);
  const highlighted = await sentenceScores(
    post,
    query,
    hits.map(([, i]) => all[i][1]),
  );
  yield {
    type: 'retrieved',
    query: question,
    searched: all.length,
    per_book: PER_BOOK,
    ms,
    chunks: hits.map(([score, i], h) => ({
      book: TITLES[all[i][0]],
      score: round3(score),
      text: all[i][1],
      sentences: highlighted[h],
    })),
  };
  const excerpts = hits.map(([, i]) => `[${TITLES[all[i][0]]}]\n${all[i][1]}`).join('\n\n');
  const result = await complete(
    post,
    `Excerpts from Dickens' novels:\n\n${excerpts}\n\n---\n${question}\nAnswer from the excerpts. ${style(120)}`,
  );
  yield {type: 'answer', ...result, calls: 2};
}

async function* runAgents(post: Post, library: Library, question: string) {
  yield {type: 'plan', books: bookInfos(await library.meta())};
  const queue: Event[] = [];
  let wake: (() => void) | null = null;
  const emit = (event: Event) => {
    queue.push(event);
    wake?.();
  };

  const work = async (slug: string) => {
    emit({type: 'agent', slug, state: 'start'});
    try {
      const result = await complete(
        post,
        `${await labelled(library, slug)}\n\n---\nAbout this novel only: ${question}\n` +
          `If it does not address this, say so in one sentence. ${style(80)}`,
      );
      emit({type: 'agent', slug, state: 'done', ...result});
    } catch (e) {
      emit({type: 'agent', slug, state: 'error', message: (e as Error).message});
    }
  };

  const todo = BOOKS.map(([slug]) => slug);
  const worker = async () => {
    for (let slug; (slug = todo.shift());) await work(slug);
  };
  void Promise.all(Array.from({length: AGENT_WORKERS}, worker));

  const notes: Record<string, string> = {};
  let totalTokens = 0;
  for (let pending = BOOKS.length; pending;) {
    if (!queue.length) await new Promise<void>(resolve => (wake = resolve));
    wake = null;
    const event = queue.shift()!;
    yield event;
    if (event.state !== 'start') {
      pending--;
      notes[event.slug] = event.text ?? '(failed)';
      totalTokens += (event.prompt_tokens ?? 0) + (event.completion_tokens ?? 0);
    }
  }
  yield {type: 'synthesis'};
  const summary = BOOKS.map(([slug, title]) => `${title}: ${notes[slug]}`).join('\n\n');
  const result = await complete(
    post,
    `Question: ${question}\n\nNotes from reading each of Dickens' novels separately:\n\n${summary}\n\n---\n` +
      `Combine the notes into one answer to the question. ${style(150)}`,
  );
  totalTokens += result.prompt_tokens + result.completion_tokens;
  yield {type: 'answer', ...result, calls: BOOKS.length + 1, total_tokens: totalTokens};
}

/** A live run, each event stamped with `t`, seconds since the start; a failure ends it with an error event. */
export async function* runLive(
  post: Post,
  library: Library,
  method: Method,
  question: string,
  scope: Scope,
  book: string,
): AsyncGenerator<Event> {
  const events =
    method === 'stuff'
      ? runStuff(post, library, question, scope, book)
      : method === 'rag'
        ? runRag(post, library, question)
        : runAgents(post, library, question);
  const started = performance.now();
  const t = () => round3((performance.now() - started) / 1000);
  try {
    for await (const event of events) yield {...event, t: t()};
  } catch (e) {
    yield {type: 'error', message: (e as Error).message, t: t()};
  }
}

/** Recorded events, each delivered at its recorded time divided by `speed`. */
export async function* replay(events: Event[], speed: number): AsyncGenerator<Event> {
  const started = performance.now();
  for (const event of events) {
    const delay = (event.t / speed) * 1000 - (performance.now() - started);
    if (delay > 0) await sleep(delay);
    yield event;
  }
}

export function recordingKey(method: Method, question: string, scope: Scope) {
  const preset = QUESTIONS.find(q => q.text === question);
  return preset ? `${method}|${preset.id}|${method === 'stuff' ? scope : '-'}` : null;
}

export interface ContextData {
  speed: string;
  runs: Record<string, {events: Event[]}>;
}
