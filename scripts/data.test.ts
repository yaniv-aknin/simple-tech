import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  BOOKS,
  DIMS,
  METHODS,
  QUESTIONS,
  chunks,
  recordingKey,
  type ContextData,
} from '../src/ai/core/context.ts';
import {TASKS, entryKey, taskRuns, type GptsData} from '../src/ai/core/gpts.ts';
import {MODES, entryKey as toolKey, type ToolsData} from '../src/ai/core/tools.ts';
import {DATA, TEXTS} from './lib.ts';

const json = <T>(name: string): T => JSON.parse(readFileSync(join(DATA, name), 'utf8'));

describe('recordings the pages replay', () => {
  it('has every GPT run', () => {
    const {entries} = json<GptsData>('gpts.json');
    for (const [taskId, task] of Object.entries(TASKS)) {
      for (const option of task.options) {
        for (const model of option.models.filter(m => !m.client)) {
          for (let run = 0; run < taskRuns(task); run++) {
            expect(entries, entryKey(taskId, option.id, model.id, run)).toHaveProperty([
              entryKey(taskId, option.id, model.id, run),
            ]);
          }
        }
      }
    }
  });

  it('has both modes for every recorded maze', () => {
    const {entries} = json<ToolsData>('tools.json');
    const recorded = TASKS['s-m-l'].options.filter(o =>
      Object.keys(entries).some(k => k.startsWith(o.id + '/')),
    );
    expect(recorded.length).toBeGreaterThan(0);
    for (const option of recorded) {
      for (const model of option.models) {
        for (const mode of MODES) expect(entries).toHaveProperty([toolKey(option.id, model.id, mode)]);
      }
    }
  });

  it('has every Dickens question, method and scope', () => {
    const {runs} = json<ContextData>('context.json');
    for (const question of QUESTIONS) {
      for (const method of METHODS) {
        for (const scope of method === 'stuff' ? (['book', 'all'] as const) : (['book'] as const)) {
          expect(runs).toHaveProperty([recordingKey(method, question.text, scope)!]);
        }
      }
    }
  });
});

describe('Dickens index', () => {
  const meta = json<{dims: number; chunks: number; bytes: Record<string, number>}>('dickens_index.json');
  const bookFile = (slug: string) => join(TEXTS, 'dickens', `${slug}.txt`);

  it('matches the texts it was built from', async () => {
    const library = {
      text: async (slug: string) => readFileSync(bookFile(slug), 'utf8'),
      vectors: async () => new Float32Array(),
      meta: async () => ({...meta, model: ''}),
    };
    expect((await chunks(library)).length).toBe(meta.chunks);
    expect(statSync(join(DATA, 'dickens.vec')).size).toBe(meta.chunks * DIMS * 4);
    for (const [slug] of BOOKS) expect(meta.bytes[slug]).toBe(statSync(bookFile(slug)).size);
  });
});
