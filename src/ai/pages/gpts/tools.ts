import {buildPage} from '../shared/page.ts';
import './gpts.css';
import './tools.css';
import html from './python.html?raw';
import type {Mount} from '../../../page.ts';
import {TASKS, speedOf, type Model, type Option} from '../../core/gpts.ts';
import {RESPONSES_URL, type Json} from '../../core/openai.ts';
import {
  MODES,
  entryKey,
  finalText,
  runAgent,
  type Mode,
  type Recording,
  type ToolRun,
  type ToolsData,
  type Turn,
} from '../../core/tools.ts';
import {el, fetchJson} from '../shared/dom.ts';
import {livePost} from '../shared/key.ts';
import {expectedAnswer, isCorrect, joinPrompt, renderMaze, splitPrompt, type Parts} from './prompt.ts';
import {runPython, warmUp} from './pyodide.ts';

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

export const mount: Mount = (root, signal) => {
  const {$, $text, getIntParam, getParam, setParam} = buildPage(root, html);

  let config: {speed: number; options: OptionView[]};
  let current = 0;
  let mode: Mode = 'tools';
  let token = 0;
  let parts: Parts;
  let editing = false;

  const option = () => config.options[current];
  const isEdited = () => joinPrompt(parts) !== option().prompt;

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

  function renderPrompt() {
    const q = document.createElement('div');
    q.className = 'q';
    q.style.fontSize = '22px';
    q.textContent = parts.grid === null ? parts.head : `${parts.head} ${parts.tail}`;
    const expected = expectedAnswer(option(), parts);
    const truth = document.createElement('div');
    truth.className = 'truth';
    truth.hidden = expected === null;
    truth.innerHTML = 'Correct answer<b></b>';
    truth.querySelector('b')!.textContent = expected;
    const sizes = document.createElement('div');
    sizes.className = 'sizes';
    config.options.forEach((option, i) => {
      const button = el('button', i === current ? 'on' : '', `${option.id}×${option.id}`);
      button.addEventListener('click', () => selectOption(i));
      sizes.append(button);
    });
    const side = el('div', 'side');
    side.append(truth, sizes);
    const maze = parts.grid === null ? [] : [renderMaze(parts.grid, openEditor)];
    $('prompt').replaceChildren(q, ...maze, side);
    renderMode();
  }

  function renderMode() {
    const box = $('mode');
    box.replaceChildren();
    if (!isEdited()) return;
    const reset = el('button', '', 'reset');
    reset.addEventListener('click', () => selectOption(current));
    box.append(reset);
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

  function requestText(body: Json) {
    return `POST ${RESPONSES_URL}\nContent-Type: application/json\nAuthorization: Bearer $OPENAI_API_KEY\n\n${pretty(body)}`;
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

  function requestStep(body: Json, i: number) {
    const kinds = (body.input as Json[]).map(item => item.role ?? item.type);
    const label = i ? `request ${i + 1}` : 'request';
    const box = step('request', `→ ${label}`, 'POST /v1/responses', {
      title: `${label} · as sent`,
      text: requestText(body),
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
    const where = run.sandbox ?? `fresh ${run.container?.image ?? 'container'}, no network`;
    const meta = `${secs(run.duration_ms)} · ${status} · ${where}`;
    const box = step('tool', '⚙ sandbox', meta, {title: 'sandbox run', text: sandboxText(run)});
    box.append(el('div', 'label', 'returned to the model'), el('pre', 'out', run.output || '(empty)'));
    return box;
  }

  function answerStep(text: string, expected: string | null) {
    const right = expected !== null && isCorrect(text, expected);
    const box =
      expected === null
        ? step('answer', '= answer', '')
        : step(right ? 'ok' : 'bad', right ? '✓ correct' : '✗ wrong', `expected ${expected}`);
    box.append(el('div', 'text', text.trim() || '(empty)'));
    return box;
  }

  function scoreText(text: string, expected: string | null, ms: number) {
    const mark = expected === null ? '' : isCorrect(text, expected) ? '✓ ' : '✗ ';
    return mark + secs(ms);
  }

  /* ---------- terminal view ---------- */

  function fitTerminal() {
    const code = $('code');
    code.style.height = 'auto';
    code.style.height = Math.min(code.scrollHeight, root.clientHeight * 0.8) + 'px';
  }

  function openTerminal(title: string, text: string, editable = false) {
    editing = editable;
    $('terminalTitle').textContent = title;
    $text('code').readOnly = !editable;
    $text('code').value = text;
    $('modal').hidden = false;
    fitTerminal();
    $('code').scrollTop = 0;
  }

  const openEditor = () => openTerminal('message, exactly as sent', joinPrompt(parts), true);

  function closeTerminal() {
    $('modal').hidden = true;
    if (!editing || $text('code').value === joinPrompt(parts)) return;
    parts = splitPrompt($text('code').value);
    token++;
    renderPrompt();
    renderResults();
  }

  /* ---------- running ---------- */

  function columns() {
    return option().models.map((m, mi) => {
      const col = $('results').children[mi];
      const log = col.querySelector<HTMLElement>('.log')!;
      let stick = true;
      log.addEventListener('scroll', () => {
        stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
      });
      const show = (node: HTMLElement) => {
        log.append(node);
        if (stick) log.scrollTop = log.scrollHeight;
      };
      return {m, show, score: col.querySelector('.score')!};
    });
  }

  function start() {
    const mine = ++token;
    renderResults();
    if (isEdited()) startLive(mine);
    else replay(mine);
  }

  function replay(mine: number) {
    const expected = option().truth!;
    for (const {m, show, score} of columns()) {
      const recording = m.recordings[mode];
      if (!recording) {
        show(el('div', 'note', 'No recording. Run scripts/refresh-tools.ts'));
        continue;
      }
      for (const event of timeline(recording)) {
        setTimeout(() => {
          if (mine !== token) return;
          if (event.kind === 'request') show(requestStep(event.turn.request.body, event.i));
          else if (event.kind === 'response') show(responseStep(event));
          else if (event.kind === 'tool') show(toolStep(event));
          else {
            show(answerStep(event.text, expected));
            score.textContent = scoreText(event.text, expected, event.at);
          }
        }, event.at / config.speed);
      }
    }
  }

  /** The edited question, asked live; the model's code runs in Pyodide in this browser. */
  async function startLive(mine: number) {
    const prompt = joinPrompt(parts);
    const expected = expectedAnswer(option(), parts);
    const cols = columns();
    if (mode === 'tools') warmUp();
    let post;
    try {
      post = await livePost();
    } catch (e) {
      for (const {show} of cols) show(el('div', 'note', (e as Error).message));
      return;
    }
    for (const {m, show, score} of cols) {
      const live =
        <T>(f: (x: T, i: number) => HTMLElement) =>
        (x: T, i: number) => {
          if (mine === token) show(f(x, i));
        };
      runAgent(post, runPython, m.api!, prompt, mode === 'tools', {
        request: live(requestStep),
        response: live((turn, i) => responseStep({turn, i})),
        tool: live(run => toolStep({run})),
      }).then(
        recording => {
          if (mine !== token) return;
          const text = finalText(recording);
          show(answerStep(text, expected));
          score.textContent = scoreText(text, expected, recording.total_ms);
        },
        e => {
          if (mine === token) show(el('div', 'note', (e as Error).message));
        },
      );
    }
  }

  /* ---------- wiring ---------- */

  function selectMode(next: Mode) {
    mode = next;
    setParam('mode', mode === 'tools' ? null : mode);
    $('switch')
      .querySelectorAll<HTMLElement>('button')
      .forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    token++;
    renderResults();
  }

  function selectOption(i: number) {
    current = i;
    setParam('option', i || null);
    parts = splitPrompt(option().prompt);
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
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && !$('modal').hidden) closeTerminal();
    },
    {signal},
  );
  $('switch')
    .querySelectorAll<HTMLElement>('button')
    .forEach(b =>
      b.addEventListener('click', () => {
        selectMode(b.dataset.mode as Mode);
        b.blur();
      }),
    );

  fetchJson<ToolsData>('data/tools.json')
    .then(data => {
      config = buildConfig(data);
      const wanted = getIntParam('option', 0);
      selectOption(wanted < config.options.length ? wanted : 0);
      selectMode(getParam('mode') === 'plain' ? 'plain' : 'tools');
    })
    .catch(e => {
      $('prompt').textContent = 'Could not load: ' + e.message;
    });
};
