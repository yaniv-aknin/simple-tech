/**
 * Re-record the scripted conversation on the Wikipedia tool page into public/ai/data/wiki.json.
 *
 *     node scripts/refresh-wiki.ts
 *
 * The typed lines below are replayed as written, each answered by the live model. A tool call from the model is
 * followed by the Wikipedia article as the next user turn. Needs OPENAI_API_KEY.
 */
import {join} from 'node:path';
import {TOOL_LINE, fetchArticle, liveChat, type Exchange, type Message} from '../src/ai/core/wiki.ts';
import {DATA, livePost, writeJson} from './lib.ts';

const FILE = join(DATA, 'wiki.json');
const AWKWARD = /article|shared|provided|according to|you gave/i;
const LINES = ['Hi there', 'How much is 37.0C in Farenheit?', 'What happened to Dolly Parton?'];

const post = livePost();

async function record() {
  const messages: Message[] = [];
  const exchanges: Exchange[] = [];
  const queue = [...LINES];
  let pendingCall: string | null = null;
  while (queue.length || pendingCall) {
    let content: string;
    let exchange: Omit<Exchange, 'response'>;
    if (pendingCall) {
      const article = await fetchArticle(pendingCall);
      content = `Result of #WIKIPEDIA ${pendingCall}:\n\n${article.text}`;
      exchange = {tool_title: pendingCall, tool_chars: [...content].length};
      pendingCall = null;
    } else {
      content = queue.shift()!;
      exchange = {user: content};
    }
    messages.push({role: 'user', content});
    let {text, latency_ms} = await liveChat(post, messages);
    const call = TOOL_LINE.exec(text);
    if (call) {
      text = text.slice(0, call.index + call[0].length);
      pendingCall = call[1];
    }
    messages.push({role: 'assistant', content: text});
    exchanges.push({...exchange, response: {text, latency_ms}});
    console.log(
      `${JSON.stringify((exchange.user ?? 'tool result').slice(0, 40))} -> ${JSON.stringify(text.slice(0, 70))}`,
    );
  }
  return exchanges;
}

let exchanges: Exchange[] = [];
for (let attempt = 0; attempt < 5; attempt++) {
  exchanges = await record();
  const last = exchanges[exchanges.length - 1].response.text;
  if (last.startsWith('#') || !AWKWARD.test(last)) break;
  console.log('answer mentions its source; retrying');
}
writeJson(FILE, {exchanges});
