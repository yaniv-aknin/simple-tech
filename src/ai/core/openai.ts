export const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

export type Json = Record<string, any>;

/** One HTTP exchange exactly as sent and received, with wall-clock latency. */
export interface WireRecord {
  started_at: string;
  latency_ms: number;
  request: {url: string; body: Json};
  response: {status: number; body: Json};
}

export type Post = (url: string, body: Json) => Promise<WireRecord>;

let maxCalls = 200;
let calls = 0;

export function setCallLimit(n: number) {
  maxCalls = n;
}

export const nowIso = () => new Date().toISOString().replace('Z', '+00:00');
export const roundMs = (ms: number) => Math.round(ms * 10) / 10;
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A `Post` that calls the OpenAI API with `key`, at most `setCallLimit()` times per process or page. */
export function poster(key: string): Post {
  return async (url, body) => {
    if (calls >= maxCalls) throw new Error(`Live call limit reached (${maxCalls})`);
    calls++;
    const started_at = nowIso();
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    }).catch(e => {
      throw new Error(`${body.model}: ${e.message}`);
    });
    const payload = (await res.json().catch(() => null)) as Json | null;
    if (!res.ok) throw new Error(`${body.model}: ${payload?.error?.message ?? res.statusText}`);
    return {
      started_at,
      latency_ms: roundMs(performance.now() - t0),
      request: {url, body},
      response: {status: res.status, body: payload!},
    };
  };
}

export const chat = (post: Post, model: string, prompt: string, params: Json = {}) =>
  post(CHAT_URL, {model, messages: [{role: 'user', content: prompt}], ...params});

/** The answer text of a chat completion, or of a recorded GPT-2 run. */
export function recordText(record: WireRecord): string {
  const body = record.response.body;
  if ('choices' in body) return body.choices[0].message.content ?? '';
  return body.continuation;
}
