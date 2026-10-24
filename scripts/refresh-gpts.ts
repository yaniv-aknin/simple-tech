/**
 * Re-run the GPT demo prompts and save full requests, responses and latencies to public/ai/data/gpts.json.
 *
 *     node scripts/refresh-gpts.ts                  # everything
 *     node scripts/refresh-gpts.ts s-m-l/16         # one task/option
 *     node scripts/refresh-gpts.ts s-m-l/16/astra   # one model
 *
 * Responses are stored exactly as received; the web app does all formatting. The top-level "speed" in the
 * JSON is kept; the web app divides replayed latencies by it. Frozen models (GPT-2, GPT-4) keep their
 * recordings. Needs OPENAI_API_KEY.
 */
import {join} from 'node:path';
import {TASKS, entryKey, taskRuns, type GptsData} from '../src/ai/core/gpts.ts';
import {chat, recordText} from '../src/ai/core/openai.ts';
import {DATA, livePost, mapLimit, matches, readJson, sortedEntries, writeJson} from './lib.ts';

const FILE = join(DATA, 'gpts.json');
const filters = process.argv.slice(2).map(a => a.replace(/^\/+|\/+$/g, ''));

const jobs = Object.entries(TASKS).flatMap(([taskId, task]) =>
  task.options.flatMap(option =>
    option.models
      .filter(
        model => !model.client && !model.frozen && matches(`${taskId}/${option.id}/${model.id}`, filters),
      )
      .flatMap(model => Array.from({length: taskRuns(task)}, (_, run) => ({taskId, option, model, run}))),
  ),
);
if (!jobs.length) {
  console.error('nothing matches ' + filters.join(' '));
  process.exit(1);
}

const post = livePost();
const data = readJson<GptsData>(FILE, {speed: '1.0', entries: {}});
let failures = 0;
const run = ({option, model}: (typeof jobs)[number]) => chat(post, model.api!, option.prompt, model.params);
for await (const [{taskId, option, model, run: i}, result] of mapLimit(jobs, 24, run)) {
  const key = entryKey(taskId, option.id, model.id, i);
  if (result.status === 'rejected') {
    failures++;
    console.log(`FAILED ${key}: ${result.reason.message}`);
    continue;
  }
  data.entries[key] = result.value;
  const text = JSON.stringify(recordText(result.value).trim().slice(0, 60));
  console.log(`${key.padEnd(28)} ${(result.value.latency_ms / 1000).toFixed(1).padStart(7)}s  ${text}`);
}
data.entries = sortedEntries(data.entries);
writeJson(FILE, data);
console.log(`saved ${FILE}` + (failures ? ` (${failures} failed)` : ''));
process.exit(failures ? 1 : 0);
