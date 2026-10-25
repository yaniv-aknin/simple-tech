import {buildPage} from '../shared/page.ts';
import './gpts.css';
import './tools.css';
import './wikipedia.css';
import html from './wikipedia.html?raw';
import type {Mount} from '../../../page.ts';
import {RESET} from '../../../ui/icons.ts';
import {sleep} from '../../core/openai.ts';
import {
  SYSTEM_PROMPT,
  TOOL_LINE,
  fetchArticle,
  looksLikeDollyPartonPage,
  liveChat,
  scriptedReply,
  type Message,
  type WikiData,
} from '../../core/wiki.ts';
import {asset, el, fetchJson} from '../shared/dom.ts';
import {livePost} from '../shared/key.ts';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

export const mount: Mount = (root, signal) => {
  const {$, $text} = buildPage(root, html);

  let history: Message[] = [];
  let auto = false;
  let busy = false;
  let toolReady = false;
  let lastTitle = '';
  let script: WikiData = {exchanges: []};
  let lines: string[] = [];
  let typed = 0;
  let onTrack = true;

  function addMessage<T extends HTMLElement>(node: T) {
    $('messages').append(node);
    node.scrollIntoView({block: 'end'});
    return node;
  }

  function renderAssistant(node: HTMLElement, text: string) {
    node.replaceChildren();
    let plain: string[] = [];
    const flush = () => {
      if (plain.length) node.append(document.createTextNode(plain.join('\n')));
      plain = [];
    };
    for (const line of text.split('\n')) {
      if (TOOL_LINE.test(line)) {
        flush();
        node.append(el('div', 'toolcall', line.trim()));
      } else {
        plain.push(line);
      }
    }
    flush();
  }

  function setBusy(value: boolean) {
    busy = value;
    $<HTMLButtonElement>('send').disabled = value;
  }

  /** The recorded reply, after its recorded delay, while the conversation follows the script; else a live one. */
  async function reply(messages: Message[]) {
    const recorded = scriptedReply(script, messages);
    if (recorded) {
      await sleep(recorded.latency_ms);
      return recorded.text;
    }
    return (await liveChat(await livePost(), messages)).text;
  }

  async function askModel() {
    setBusy(true);
    const bubble = addMessage(el('div', 'msg assistant pending'));
    try {
      const answer = await reply(history);
      const call = TOOL_LINE.exec(answer);
      const text = call ? answer.slice(0, call.index + call[0].length) : answer;
      history.push({role: 'assistant', content: text});
      bubble.classList.remove('pending');
      renderAssistant(bubble, text);
      bubble.scrollIntoView({block: 'end'});
      setBusy(false);
      if (!call) prefill();
      if (call) {
        lastTitle = call[1];
        setToolReady(true);
        if (auto) await runAuto(lastTitle);
        else $('toolText').focus();
      }
    } catch (e) {
      bubble.remove();
      addMessage(el('div', 'msg error', (e as Error).message));
      setBusy(false);
    }
  }

  function prefill() {
    if (onTrack && typed < lines.length && !$text('input').value) $text('input').value = lines[typed];
  }

  function send(text: string) {
    onTrack = onTrack && text === lines[typed];
    typed++;
    history.push({role: 'user', content: text});
    addMessage(el('div', 'msg user', text));
    return askModel();
  }

  /* ---------- tool input ---------- */

  function setToolReady(on: boolean) {
    toolReady = on;
    $text('toolText').disabled = !on;
    $('toolText').classList.toggle('ready', on);
    updateToolMeta();
  }

  function updateToolMeta() {
    const text = $text('toolText').value;
    $<HTMLButtonElement>('execute').disabled = busy || !toolReady || !text.trim();
    $('toolMeta').textContent = text ? kb(new TextEncoder().encode(text).length) : '';
  }

  /* The cheat in looksLikeDollyPartonPage: a pasted copy of the live page becomes the saved article. */
  async function savedDollyParton(pasted: string) {
    try {
      const res = await fetch(asset('texts/dolly-parton.txt'));
      return res.ok ? (await res.text()).trim() : pasted;
    } catch {
      return pasted;
    }
  }

  async function execute() {
    let text = $text('toolText').value.trim();
    if (!text || busy || !toolReady) return;
    const title = lastTitle || 'unknown';
    if (/dolly parton/i.test(title) && looksLikeDollyPartonPage(text)) text = await savedDollyParton(text);
    const bytes = new TextEncoder().encode(text).length;
    history.push({role: 'user', content: `Result of #WIKIPEDIA ${title}:\n\n${text}`});
    const card = el('div', 'msg doc');
    const head = el('div', 'dhead', `📄 Wikipedia: ${title}`);
    head.append(el('span', 'dmeta', kb(bytes)));
    const track = el('div', 'track');
    track.append(document.createElement('i'));
    card.append(head, track, el('div', 'snippet', text.slice(0, 300)));
    addMessage(card);
    $text('toolText').value = '';
    setToolReady(false);
    setBusy(true);
    await sleep(1100);
    await askModel();
  }

  async function runAuto(title: string) {
    const tool = $('tool');
    tool.classList.add('auto');
    const frame = $<HTMLIFrameElement>('frame');
    const selection = $('selection');
    $('addr').textContent = `🔍 Searching Wikipedia for “${title}”…`;
    frame.removeAttribute('src');
    setBusy(true);
    try {
      const article = await fetchArticle(title);
      $('addr').textContent = article.url.replace('https://', '');
      await new Promise(resolve => {
        frame.addEventListener('load', resolve, {once: true});
        frame.src = article.url;
        setTimeout(resolve, 5000);
      });
      await sleep(700);
      $('selectionLabel').textContent = 'Select all';
      selection.classList.add('on');
      await sleep(1000);
      $('selectionLabel').textContent = 'Copy';
      await sleep(700);
      selection.classList.remove('on');
      $text('toolText').value = article.text;
      updateToolMeta();
      await sleep(900);
      setBusy(false);
      await execute();
    } catch (e) {
      $('addr').textContent = (e as Error).message;
      selection.classList.remove('on');
      setBusy(false);
    }
  }

  /* ---------- wiring ---------- */

  $('composer').addEventListener('submit', e => {
    e.preventDefault();
    const text = $text('input').value.trim();
    if (!text || busy) return;
    $text('input').value = '';
    send(text);
  });
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $<HTMLFormElement>('composer').requestSubmit();
    }
  });
  $('instructions').addEventListener('click', () => {
    $text('code').value = SYSTEM_PROMPT;
    $('modal').hidden = false;
    $('code').style.height = 'auto';
    $('code').style.height = $('code').scrollHeight + 'px';
    $('instructions').blur();
  });
  $('closeModal').addEventListener('click', () => {
    $('modal').hidden = true;
  });
  $('modal').addEventListener('click', e => {
    if (e.target === $('modal')) $('modal').hidden = true;
  });
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape') $('modal').hidden = true;
    },
    {signal},
  );
  $('toolText').addEventListener('input', updateToolMeta);
  $('execute').addEventListener('click', execute);

  $('switch').addEventListener('click', e => {
    const button = (e.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    auto = button.dataset.auto === 'on';
    for (const b of $('switch').children) b.classList.toggle('on', b === button);
    $('tool').classList.toggle('auto', auto);
    button.blur();
  });

  $('reset').innerHTML = RESET;
  $('reset').addEventListener('click', () => {
    history = [];
    lastTitle = '';
    typed = 0;
    onTrack = true;
    $text('input').value = '';
    prefill();
    $('messages').replaceChildren();
    $text('toolText').value = '';
    setToolReady(false);
    $('frame').removeAttribute('src');
    $('addr').textContent = '';
    $('selection').classList.remove('on');
    setBusy(false);
    updateToolMeta();
    $('reset').blur();
    $('input').focus();
  });

  fetchJson<WikiData>('data/wiki.json')
    .then(data => {
      script = data;
      lines = data.exchanges.flatMap(e => (e.user === undefined ? [] : [e.user]));
      prefill();
    })
    .catch(() => {});
  $('input').focus();
};
