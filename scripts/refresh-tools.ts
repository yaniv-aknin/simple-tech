/**
 * Re-run the Python-tool maze demo and save full transcripts to public/ai/data/tools.json.
 *
 *     node scripts/refresh-tools.ts                 # every maze, model and mode
 *     node scripts/refresh-tools.ts 16              # one maze
 *     node scripts/refresh-tools.ts 16/luna/tools   # one recording
 *
 * Each recording holds every request and response on the wire, plus every sandbox run (code, input,
 * container command, stdout, stderr, exit code, duration) and latencies. Needs Docker and OPENAI_API_KEY.
 */
import {join} from 'node:path';
import {TASKS} from '../src/ai/core/gpts.ts';
import {MODES, entryKey, finalText, runAgent, type ToolsData} from '../src/ai/core/tools.ts';
import {DATA, livePost, mapLimit, matches, readJson, sortedEntries, writeJson} from './lib.ts';
import {runPython} from './sandbox.ts';

const FILE = join(DATA, 'tools.json');
const filters = process.argv.slice(2).map(a => a.replace(/^\/+|\/+$/g, ''));

const jobs = TASKS['s-m-l'].options.flatMap(option =>
  option.models.flatMap(model =>
    MODES.filter(mode => matches(entryKey(option.id, model.id, mode), filters)).map(mode => ({
      option,
      model,
      mode,
    })),
  ),
);
if (!jobs.length) {
  console.error('nothing matches ' + filters.join(' '));
  process.exit(1);
}

const post = livePost();
const data = readJson<ToolsData>(FILE, {speed: '1.0', entries: {}});
let failures = 0;
const run = ({option, model, mode}: (typeof jobs)[number]) =>
  runAgent(post, runPython, model.api!, option.prompt, mode === 'tools');
for await (const [{option, model, mode}, result] of mapLimit(jobs, jobs.length, run)) {
  const key = entryKey(option.id, model.id, mode);
  if (result.status === 'rejected') {
    failures++;
    console.log(`FAILED ${key}: ${result.reason.message}`);
    continue;
  }
  const recording = result.value;
  data.entries[key] = recording;
  const runs = recording.turns.reduce((n, t) => n + t.tool_runs.length, 0);
  const answer = finalText(recording).trim();
  const mark = answer === option.truth ? 'ok ' : 'BAD';
  console.log(
    `${key.padEnd(22)} ${mark} ${(recording.total_ms / 1000).toFixed(1).padStart(6)}s  ` +
      `${recording.turns.length} turns, ${runs} sandbox runs  -> ${JSON.stringify(answer.slice(0, 40))}`,
  );
}
data.entries = sortedEntries(data.entries);
writeJson(FILE, data);
console.log(`saved ${FILE}` + (failures ? ` (${failures} failed)` : ''));
process.exit(failures ? 1 : 0);
