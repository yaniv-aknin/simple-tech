/**
 * Build the Dickens search index and record the runs replayed on the Dickens context page.
 *
 *     node scripts/refresh-context.ts index                  # embed every chunk into public/ai/data/dickens.vec
 *     node scripts/refresh-context.ts record                 # every question and method
 *     node scripts/refresh-context.ts record rag             # one method
 *     node scripts/refresh-context.ts record agents barkis   # one method on one question
 *
 * Recordings keep every event with its time offset, so replay shows the real timings. Needs OPENAI_API_KEY.
 * A full recording sends about 12M input tokens: the sub-agent runs read all of Dickens once per question.
 */
import {readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  BOOKS,
  DIMS,
  EMBED_BATCH,
  EMBED_MODEL,
  QUESTIONS,
  chunks,
  embed,
  recordingKey,
  runLive,
  type ContextData,
  type Event,
  type IndexMeta,
  type Library,
  type Method,
  type Scope,
} from '../src/ai/core/context.ts';
import {DATA, TEXTS, livePost, readJson, writeJson} from './lib.ts';

const FILE = join(DATA, 'context.json');
const VECTORS = join(DATA, 'dickens.vec');
const INDEX_META = join(DATA, 'dickens_index.json');

const bookFile = (slug: string) => join(TEXTS, 'dickens', `${slug}.txt`);
const library: Library = {
  text: async slug => readFileSync(bookFile(slug), 'utf8'),
  vectors: async () => {
    const buf = readFileSync(VECTORS);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  },
  meta: async () => JSON.parse(readFileSync(INDEX_META, 'utf8')),
};

const post = livePost();

async function buildIndex() {
  const texts = (await chunks(library)).map(([, text]) => text);
  const vectors = new Float32Array(texts.length * DIMS);
  for (let i = 0; i < texts.length; i += EMBED_BATCH * 5) {
    (await embed(post, texts.slice(i, i + EMBED_BATCH * 5))).forEach((v, j) =>
      vectors.set(v, (i + j) * DIMS),
    );
    console.log(`embedded ${Math.min(i + EMBED_BATCH * 5, texts.length)}/${texts.length}`);
  }
  writeFileSync(VECTORS, vectors);
  const meta: IndexMeta = {
    model: EMBED_MODEL,
    dims: DIMS,
    chunks: texts.length,
    bytes: Object.fromEntries(BOOKS.map(([slug]) => [slug, statSync(bookFile(slug)).size])),
  };
  writeFileSync(INDEX_META, JSON.stringify(meta) + '\n');
}

async function record(filters: Set<string>) {
  const data = readJson<ContextData>(FILE, {speed: '1.0', runs: {}});
  const runs: [Method, Scope][] = [
    ['stuff', 'book'],
    ['stuff', 'all'],
    ['rag', 'book'],
    ['agents', 'book'],
  ];
  for (const question of QUESTIONS) {
    for (const [method, scope] of runs) {
      if (filters.size && !(filters.has(method) || filters.has(question.id))) continue;
      const key = recordingKey(method, question.text, scope)!;
      const events: Event[] = [];
      for await (const event of runLive(post, library, method, question.text, scope, question.book)) {
        events.push(event);
      }
      data.runs[key] = {events};
      writeJson(FILE, data);
      const last = events[events.length - 1];
      console.log(`${key}: ${events.length} events, ${last.t}s, ends with ${last.type}`);
    }
  }
}

const [command = 'record', ...filters] = process.argv.slice(2);
if (command === 'index') await buildIndex();
else if (command === 'record') await record(new Set(filters));
else {
  console.error('usage: node scripts/refresh-context.ts index | record [method] [question]');
  process.exit(1);
}
