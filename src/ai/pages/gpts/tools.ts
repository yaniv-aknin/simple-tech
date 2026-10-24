import '../shared/page.ts';
import './gpts.css';
import './tools.css';
import {TASKS, speedOf, type Model, type Option} from '../../core/gpts.ts';
import type {Json} from '../../core/openai.ts';
import {
  MODES,
  entryKey,
  finalText,
  type Mode,
  type Recording,
  type ToolRun,
  type ToolsData,
  type Turn,
} from '../../core/tools.ts';
import {$, $text, el, fetchJson} from '../shared/dom.ts';

interface ModelView extends Model {
  recordings: Partial<Record<Mode, Recording>>;
}

interface OptionView extends Option {
  grid: string;
  truth: string;
  models: ModelView[];
}

type Event =
  | {at: number; kind: 'request'; turn: Turn; i: number}
  | {at: number; kind: 'response'; turn: Turn; i: number}
  | {at: number; kind: 'tool'; run: ToolRun; i: number}
  | {at: number; kind: 'answer'; text: string};

let config: {speed: number; options: OptionView[]};
let current = 0;
let mode: Mode = 'tools';
let token = 0;

const option = () => config.options[current];

function buildConfig(data: ToolsData) {
  const recorded = new Set(Object.keys(data.entries).map(key => key.split('/')[0]));
  const options = TASKS['s-m-l'].options
    .filter(o => recorded.has(o.id))
    .map(o => ({
      ...o,
      models: o.models.map(m => ({
        ...m,
        recordings: Object.fromEntries(MODES.map(md => [md, data.entries[entryKey(o.id, m.id, md)]])),
      })),
    }));
  return {speed: speedOf(data), options: options as OptionView[]};
}

/* ---------- prompt ---------- */

function renderMaze(grid: string) {
  const rows = grid.split('\n');
  const maze = document.createElement('div');
  maze.className = 'maze';
  maze.style.setProperty('--cols', String(rows[0].length));
  maze.style.setProperty('--rows', String(rows.length));
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const cell = document.createElement('div');
      const end = (r === 0 && c === 0) || (r === rows.length - 1 && c === row.length - 1);
      cell.className = 'c' + (ch === '#' ? ' wall' : '') + (end ? ' end' : '');
      maze.append(cell);
    }),
  );
  maze.style.cursor = 'default';
  return maze;
}

function renderPrompt() {
  const o = option();
  const lines = o.prompt.split('\n');
  const q = document.createElement('div');
  q.className = 'q';
  q.style.fontSize = '22px';
  q.textContent = `${lines[0]} ${lines[lines.length - 1]}`;
  const truth = document.createElement('div');
  truth.className = 'truth';
  truth.innerHTML = 'Correct answer<b></b>';
  truth.querySelector('b')!.textContent = o.truth;
  const sizes = document.createElement('div');
  sizes.className = 'sizes';
  config.options.forEach((option, i) => {
    const button = el('button', i === current ? 'on' : '', `${option.id}×${option.id}`);
    button.addEventListener('click', () => selectOption(i));
    sizes.append(button);
  });
  const side = el('div', 'side');
  side.append(truth, sizes);
  $('prompt').replaceChildren(q, renderMaze(o.grid), side);
}

function renderResults() {
  const results = $('results');
  results.replaceChildren();
  for (const m of option().models) {
    const col = document.createElement('div');
    col.className = 'model';
    col.innerHTML =
      '<div class="mhead"><span class="mname"></span><span class="msub"></span><span class="score"></span></div><div class="log"></div>';
    col.querySelector('.mname')!.textContent = m.name;
    col.querySelector('.msub')!.textContent = m.sub;
    results.append(col);
  }
}

/* ---------- timeline ---------- */

function timeline(recording: Recording) {
  const events: Event[] = [];
  let at = 0;
  recording.turns.forEach((turn, i) => {
    events.push({at, kind: 'request', turn, i});
    at += turn.latency_ms;
    events.push({at, kind: 'response', turn, i});
    for (const run of turn.tool_runs) {
      at += run.duration_ms;
      events.push({at, kind: 'tool', run, i});
    }
  });
  events.push({at, kind: 'answer', text: finalText(recording)});
  return events;
}

function isCorrect(text: string, expected: string) {
  const t = text.trim();
  return t !== '' && Number.isFinite(Number(t)) && Math.abs(Number(t) - Number(expected)) < 1e-9;
}

/* ---------- terminal text ---------- */

function pretty(value: unknown, indent = ''): string {
  if (typeof value === 'string') {
    return value.includes('\n') ? JSON.stringify(value).replaceAll('\\n', '\n') : JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(v => inner + pretty(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pretty(v, inner)}`).join(',\n')}\n${indent}}`;
}

function decodedCalls(body: Json) {
  return (body.output as Json[])
    .filter(item => item.type === 'function_call')
    .map(item => {
      const args = JSON.parse(item.arguments);
      return `\n--- ${item.name} arguments, decoded ---\ncode:\n${args.code}\n\ninput:\n${args.input ?? '(null)'}`;
    })
    .join('\n');
}

function requestText(turn: Turn) {
  return `POST ${turn.request.url}\nContent-Type: application/json\nAuthorization: Bearer $OPENAI_API_KEY\n\n${pretty(turn.request.body)}`;
}

function responseText(turn: Turn) {
  return `HTTP ${turn.response.status} · ${secs(turn.latency_ms)}\n\n${pretty(turn.response.body)}\n${decodedCalls(turn.response.body)}`;
}

function sandboxText(run: ToolRun) {
  const args: Json = typeof run.arguments === 'string' ? JSON.parse(run.arguments) : run.arguments;
  const command = (run.container?.command ?? []).join(' ');
  return [
    `$ ${command}`,
    `--- stdin: code ---\n${args.code}`,
    `--- stdin: input ---\n${args.input ?? '(null)'}`,
    `--- stdout ---\n${run.stdout ?? ''}`,
    `--- stderr ---\n${run.stderr ?? ''}`,
    `exit ${run.exit_code}${run.timed_out ? ' (timed out)' : ''} · ${secs(run.duration_ms)}`,
    `--- returned to the model ---\n${run.output}`,
  ].join('\n\n');
}

/* ---------- steps ---------- */

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;

function step(kind: string, title: string, meta: string, wire?: {title: string; text: string}) {
  const box = el('div', `step ${kind}`);
  const head = el('div', 'title');
  head.append(el('span', '', title), el('span', 'meta', meta));
  box.append(head);
  if (wire) {
    box.classList.add('clickable');
    box.title = 'Open in terminal view';
    box.addEventListener('click', () => openTerminal(wire.title, wire.text));
  }
  return box;
}

function requestStep({turn, i}: {turn: Turn; i: number}) {
  const body = turn.request.body;
  const kinds = (body.input as Json[]).map(item => item.role ?? item.type);
  const label = i ? `request ${i + 1}` : 'request';
  const box = step('request', `→ ${label}`, 'POST /v1/responses', {
    title: `${label} · as sent`,
    text: requestText(turn),
  });
  const tools = ((body.tools ?? []) as Json[]).map(tool => tool.name);
  box.append(
    el(
      'div',
      'note',
      `${body.model} · reasoning ${body.reasoning.effort} · tools: ${tools.join(', ') || 'none'}`,
    ),
  );
  box.append(el('div', 'note', `input: ${kinds.join(', ')}`));
  return box;
}

function responseStep({turn, i}: {turn: Turn; i: number}) {
  const body = turn.response.body;
  const usage = body.usage;
  const reasoning = usage.output_tokens_details.reasoning_tokens;
  const meta =
    `${secs(turn.latency_ms)} · ${usage.total_tokens} tokens` +
    (reasoning ? ` (${reasoning} reasoning)` : '');
  const box = step('response', '← response', meta, {
    title: `response ${i + 1} · as received`,
    text: responseText(turn),
  });
  for (const item of body.output as Json[]) {
    if (item.type === 'function_call') {
      const args = JSON.parse(item.arguments);
      box.append(el('div', 'label', `calls ${item.name}(code, input)`), el('pre', 'code', args.code));
      if (args.input) box.append(el('div', 'label', 'input'), el('pre', 'code', args.input));
    } else if (item.type === 'message') {
      box.append(el('div', 'text', (item.content as Json[]).map(part => part.text ?? '').join('')));
    } else {
      box.append(el('div', 'note', item.type));
    }
  }
  return box;
}

function toolStep({run}: {run: ToolRun}) {
  const status = run.timed_out ? 'timed out' : `exit ${run.exit_code}`;
  const meta = `${secs(run.duration_ms)} · ${status} · fresh ${run.container?.image ?? 'container'}, no network`;
  const box = step('tool', '⚙ sandbox', meta, {title: 'sandbox run', text: sandboxText(run)});
  box.append(el('div', 'label', 'returned to the model'), el('pre', 'out', run.output || '(empty)'));
  return box;
}

function answerStep(text: string, expected: string) {
  const right = isCorrect(text, expected);
  const box = step(right ? 'ok' : 'bad', right ? '✓ correct' : '✗ wrong', `expected ${expected}`);
  box.append(el('div', 'text', text.trim() || '(empty)'));
  return box;
}

/* ---------- terminal view ---------- */

function fitTerminal() {
  const code = $('code');
  code.style.height = 'auto';
  code.style.height = Math.min(code.scrollHeight, window.innerHeight * 0.8) + 'px';
}

function openTerminal(title: string, text: string) {
  $('terminalTitle').textContent = title;
  $text('code').value = text;
  $('modal').hidden = false;
  fitTerminal();
  $('code').scrollTop = 0;
}

function closeTerminal() {
  $('modal').hidden = true;
}

/* ---------- running ---------- */

function start() {
  const mine = ++token;
  renderResults();
  const expected = option().truth;
  option().models.forEach((m, mi) => {
    const col = $('results').children[mi];
    const log = col.querySelector<HTMLElement>('.log')!;
    const recording = m.recordings[mode];
    if (!recording) {
      log.append(el('div', 'note', 'No recording. Run scripts/refresh-tools.ts'));
      return;
    }
    let stick = true;
    log.addEventListener('scroll', () => {
      stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    });
    for (const event of timeline(recording)) {
      setTimeout(() => {
        if (mine !== token) return;
        if (event.kind === 'request') log.append(requestStep(event));
        else if (event.kind === 'response') log.append(responseStep(event));
        else if (event.kind === 'tool') log.append(toolStep(event));
        else {
          log.append(answerStep(event.text, expected));
          const score = col.querySelector('.score')!;
          score.textContent = `${isCorrect(event.text, expected) ? '✓' : '✗'} ${secs(event.at)}`;
        }
        if (stick) log.scrollTop = log.scrollHeight;
      }, event.at / config.speed);
    }
  });
}

/* ---------- wiring ---------- */

function selectMode(next: Mode) {
  mode = next;
  document
    .querySelectorAll<HTMLElement>('#switch button')
    .forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  token++;
  renderResults();
}

function selectOption(i: number) {
  current = i;
  renderPrompt();
  token++;
  renderResults();
}

$('go').addEventListener('click', () => {
  start();
  $('go').blur();
});
$('closeModal').addEventListener('click', closeTerminal);
$('modal').addEventListener('mousedown', e => {
  if (e.target === $('modal')) closeTerminal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('modal').hidden) closeTerminal();
});
document.querySelectorAll<HTMLElement>('#switch button').forEach(b =>
  b.addEventListener('click', () => {
    selectMode(b.dataset.mode as Mode);
    b.blur();
  }),
);

fetchJson<ToolsData>('data/tools.json')
  .then(data => {
    config = buildConfig(data);
    selectOption(0);
    selectMode('tools');
  })
  .catch(e => {
    $('prompt').textContent = 'Could not load: ' + e.message;
  });
