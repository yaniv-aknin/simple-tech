(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const TOOL_LINE = /^[ \t]*#WIKIPEDIA[ \t]+(.+?)[ \t]*$/im;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

let history = [];
let auto = false;
let busy = false;
let lastTitle = '';
let lines = [];
let typed = 0;
let onTrack = true;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addMessage(node) {
  $('messages').append(node);
  node.scrollIntoView({ block: 'end' });
  return node;
}

function renderAssistant(node, text) {
  node.replaceChildren();
  let plain = [];
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

function setBusy(value) {
  busy = value;
  $('send').disabled = value;
}

async function askModel() {
  setBusy(true);
  const bubble = addMessage(el('div', 'msg assistant pending'));
  try {
    const res = await fetch('/api/wiki/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    const call = TOOL_LINE.exec(body.text);
    const text = call ? body.text.slice(0, call.index + call[0].length) : body.text;
    history.push({ role: 'assistant', content: text });
    bubble.classList.remove('pending');
    renderAssistant(bubble, text);
    bubble.scrollIntoView({ block: 'end' });
    setBusy(false);
    if (!call) prefill();
    if (call) {
      lastTitle = call[1];
      if (auto) await runAuto(lastTitle);
      else $('toolText').focus();
    }
  } catch (e) {
    bubble.remove();
    addMessage(el('div', 'msg error', e.message));
    setBusy(false);
  }
}

function prefill() {
  if (onTrack && typed < lines.length && !$('input').value) $('input').value = lines[typed];
}

function send(text) {
  onTrack = onTrack && text === lines[typed];
  typed++;
  history.push({ role: 'user', content: text });
  addMessage(el('div', 'msg user', text));
  return askModel();
}

/* ---------- tool input ---------- */

function updateToolMeta() {
  const text = $('toolText').value;
  $('execute').disabled = busy || !text.trim();
  $('toolMeta').textContent = text ? kb(new TextEncoder().encode(text).length) : '';
}

async function execute() {
  const text = $('toolText').value.trim();
  if (!text || busy) return;
  const title = lastTitle || 'unknown';
  const bytes = new TextEncoder().encode(text).length;
  history.push({ role: 'user', content: `Result of #WIKIPEDIA ${title}:\n\n${text}` });
  const card = el('div', 'msg doc');
  const head = el('div', 'dhead', `📄 Wikipedia: ${title}`);
  head.append(el('span', 'dmeta', kb(bytes)));
  const track = el('div', 'track');
  track.append(document.createElement('i'));
  card.append(head, track, el('div', 'snippet', text.slice(0, 300)));
  addMessage(card);
  $('toolText').value = '';
  updateToolMeta();
  setBusy(true);
  await sleep(1100);
  await askModel();
}

async function runAuto(title) {
  const tool = $('tool');
  tool.classList.add('auto');
  const frame = $('frame');
  const selection = $('selection');
  $('addr').textContent = `🔍 Searching Wikipedia for “${title}”…`;
  frame.removeAttribute('src');
  setBusy(true);
  try {
    const res = await fetch('/api/wiki/article?title=' + encodeURIComponent(title));
    const article = await res.json();
    if (!res.ok) throw new Error(article.error || res.statusText);
    $('addr').textContent = article.url.replace('https://', '');
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
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
    $('toolText').value = article.text;
    updateToolMeta();
    await sleep(900);
    setBusy(false);
    await execute();
  } catch (e) {
    $('addr').textContent = e.message;
    selection.classList.remove('on');
    setBusy(false);
  }
}

/* ---------- wiring ---------- */

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (!text || busy) return;
  $('input').value = '';
  send(text);
});
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});
$('instructions').addEventListener('click', async () => {
  const { text } = await (await fetch('/api/wiki/instructions')).json();
  $('code').value = text;
  $('modal').hidden = false;
  $('code').style.height = 'auto';
  $('code').style.height = $('code').scrollHeight + 'px';
  $('instructions').blur();
});
$('closeModal').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; });
$('toolText').addEventListener('input', updateToolMeta);
$('execute').addEventListener('click', execute);

$('switch').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  auto = button.dataset.auto === 'on';
  for (const b of $('switch').children) b.classList.toggle('on', b === button);
  $('tool').classList.toggle('auto', auto);
  button.blur();
});

$('reset').addEventListener('click', () => {
  history = [];
  lastTitle = '';
  typed = 0;
  onTrack = true;
  $('input').value = '';
  prefill();
  $('messages').replaceChildren();
  $('toolText').value = '';
  $('frame').removeAttribute('src');
  $('addr').textContent = '';
  $('selection').classList.remove('on');
  setBusy(false);
  updateToolMeta();
  $('reset').blur();
  $('input').focus();
});

fetch('/api/wiki/script').then((res) => res.json()).then((script) => {
  lines = script.lines;
  prefill();
}).catch(() => {});
$('input').focus();
})();
