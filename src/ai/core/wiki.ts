import {CHAT_URL, recordText, type Post} from './openai.ts';

export const MODEL = 'gpt-6-luna';
export const TOOL_LINE = /^[ \t]*#WIKIPEDIA[ \t]+(.+?)[ \t]*$/im;
const MAX_BYTES = 600_000;
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'simple-tech-ai-explainers/0.1';

export const SYSTEM_PROMPT = `You are a chat assistant. Write plain text, no markdown.

To look something up on Wikipedia, end your message with a line: #WIKIPEDIA <article title>
The next message is the Wikipedia text. It is undisputed truth, newer than your memory, and wins over it. State what it says as plain fact, as if you had always known it: never write "according to", "the article", "you shared" or similar.

For recent events, people's news or obscure facts, reply with only the #WIKIPEDIA line. Do not look up anything else.`;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Article {
  title: string;
  url: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

export interface Exchange {
  user?: string;
  tool_title?: string;
  tool_chars?: number;
  response: {text: string; latency_ms: number};
}

export interface WikiData {
  exchanges: Exchange[];
}

async function wikiGet(params: Record<string, string | number>) {
  const query = new URLSearchParams({action: 'query', format: 'json', formatversion: '2', origin: '*'});
  for (const [k, v] of Object.entries(params)) query.set(k, String(v));
  const res = await fetch(`${WIKI_API}?${query}`, {
    headers: {'Api-User-Agent': USER_AGENT},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Wikipedia: ${res.statusText}`);
  return ((await res.json()) as {query: any}).query;
}

/** Like Python's urllib.parse.quote: only letters, digits, `_.-~` and `/` stay as they are. */
const quote = (s: string) =>
  encodeURIComponent(s)
    .replace(/%2F/g, '/')
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export async function fetchArticle(title: string): Promise<Article> {
  const hits = (await wikiGet({list: 'search', srsearch: title, srlimit: 1})).search;
  if (!hits.length) throw new Error(`No Wikipedia article found for '${title}'`);
  const best: string = hits[0].title;
  const pages = (await wikiGet({prop: 'extracts', explaintext: 1, exsectionformat: 'wiki', titles: best}))
    .pages;
  let text: string = pages[0].extract ?? '';
  const encoded = new TextEncoder().encode(text);
  const truncated = encoded.length > MAX_BYTES;
  if (truncated) text = new TextDecoder().decode(encoded.slice(0, MAX_BYTES)).replace(/�+$/, '');
  return {
    title: best,
    url: 'https://en.wikipedia.org/wiki/' + quote(best.replaceAll(' ', '_')),
    text,
    bytes: Math.min(encoded.length, MAX_BYTES),
    truncated,
  };
}

export async function liveChat(post: Post, messages: Message[]) {
  const record = await post(CHAT_URL, {
    model: MODEL,
    messages: [{role: 'system', content: SYSTEM_PROMPT}, ...messages],
    reasoning_effort: 'low',
    max_completion_tokens: 4000,
  });
  return {text: recordText(record), latency_ms: record.latency_ms};
}

function userMatches(exchange: Exchange, content: string) {
  if (exchange.user !== undefined) return content === exchange.user;
  const expected = exchange.tool_chars!;
  return (
    content.startsWith(`Result of #WIKIPEDIA ${exchange.tool_title}:`) &&
    Math.abs(content.length - expected) <= expected * 0.25
  );
}

/** The recorded response when `messages` is exactly the recorded conversation so far, else null. */
export function scriptedReply(script: WikiData, messages: Message[]) {
  const {exchanges} = script;
  const k = Math.floor(messages.length / 2);
  if (messages.length % 2 === 0 || k >= exchanges.length) return null;
  for (let i = 0; i < k; i++) {
    if (
      !userMatches(exchanges[i], messages[2 * i].content) ||
      messages[2 * i + 1].content !== exchanges[i].response.text
    ) {
      return null;
    }
  }
  return userMatches(exchanges[k], messages[2 * k].content) ? exchanges[k].response : null;
}
