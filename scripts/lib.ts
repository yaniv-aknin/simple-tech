import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {poster, setCallLimit} from '../src/ai/core/openai.ts';

export const ROOT = join(import.meta.dirname, '..');
export const AI = join(ROOT, 'public', 'ai');
export const DATA = join(AI, 'data');
export const TEXTS = join(AI, 'texts');

/** OPENAI_API_KEY from the environment, else from the repo's .env. */
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = join(ROOT, '.env');
  if (!existsSync(envFile)) return null;
  return readFileSync(envFile, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*["']?(.*?)["']?\s*$/m)?.[1] ?? null;
}

export function livePost() {
  const key = loadKey();
  if (!key) throw new Error('OPENAI_API_KEY is not set (in the environment or .env)');
  setCallLimit(Number(process.env.MAX_LIVE_CALLS ?? 200));
  return poster(key);
}

export const readJson = <T>(path: string, fallback: T): T =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;

export function writeJson(path: string, data: unknown) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n');
  renameSync(tmp, path);
}

/** `f` over `items`, at most `limit` at a time, in completion order. */
export async function* mapLimit<T, R>(items: T[], limit: number, f: (item: T) => Promise<R>) {
  const running = new Map<number, Promise<[number, PromiseSettledResult<R>]>>();
  let next = 0;
  const launch = (i: number) =>
    running.set(
      i,
      f(items[i]).then(
        value => [i, {status: 'fulfilled', value}] as [number, PromiseSettledResult<R>],
        reason => [i, {status: 'rejected', reason}] as [number, PromiseSettledResult<R>],
      ),
    );
  while (next < Math.min(limit, items.length)) launch(next++);
  while (running.size) {
    const [i, result] = await Promise.race(running.values());
    running.delete(i);
    if (next < items.length) launch(next++);
    yield [items[i], result] as const;
  }
}

/** Command-line paths like `s-m-l/16` select every key equal to or below them; none selects all. */
export const matches = (path: string, filters: string[]) =>
  !filters.length || filters.some(f => path === f || path.startsWith(f + '/'));

export const sortedEntries = <T>(entries: Record<string, T>) =>
  Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
