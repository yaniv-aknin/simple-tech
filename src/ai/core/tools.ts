import {RESPONSES_URL, nowIso, roundMs, type Json, type Post, type WireRecord} from './openai.ts';

export const IMAGE = 'python:3.13-alpine';
export const TIME_LIMIT_S = 5;
const MAX_TURNS = 8;
export const MODES = ['plain', 'tools'] as const;
export type Mode = (typeof MODES)[number];

export const TOOL_SPEC = {
  type: 'function',
  name: 'run_python',
  description:
    'Run Python code in a sandbox with no network and no third-party libraries, stopped after ' +
    `${TIME_LIMIT_S} seconds. The code must define main(input); it is called with \`input\` (a string, or None) ` +
    'and its return value is returned as a string, after anything the code printed.',
  parameters: {
    type: 'object',
    properties: {
      code: {type: 'string', description: 'Python source defining main(input).'},
      input: {type: ['string', 'null'], description: 'Passed to main() as its only argument.'},
    },
    required: ['code'],
  },
};

export interface SandboxRun {
  started_at: string;
  duration_ms: number;
  container?: {image: string; command: string[]};
  exit_code?: number;
  timed_out?: boolean;
  stdout?: string;
  stderr?: string;
  /** Where the code ran, when not in a Docker container. */
  sandbox?: string;
  /** What goes back to the model. */
  output: string;
}

export type ToolRun = SandboxRun & {call_id: string; arguments: Json | string};
export type Turn = WireRecord & {tool_runs: ToolRun[]};

export interface Recording {
  started_at: string;
  total_ms: number;
  turns: Turn[];
}

export interface ToolsData {
  speed: string;
  entries: Record<string, Recording>;
}

export type RunPython = (code: string, input: string | null) => Promise<SandboxRun>;

const MAX_OUTPUT_CHARS = 10000;

/** What the model is told about a sandbox run: the output, or why there is none. */
export function sandboxOutput(exitCode: number, stdout: string, stderr: string) {
  const output =
    exitCode === 137
      ? `Error: stopped after ${TIME_LIMIT_S} seconds`
      : exitCode
        ? `Error (exit code ${exitCode}):\n${stderr}${stdout}`
        : stdout;
  return output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n...(truncated)' : output;
}

/** Called as a run progresses, for showing it live. */
export interface AgentProgress {
  request?(body: Json, i: number): void;
  response?(turn: Turn, i: number): void;
  tool?(run: ToolRun, i: number): void;
}

/** Responses API loop: call the model, run any run_python calls in the sandbox, feed results back, repeat. */
export async function runAgent(
  post: Post,
  runPython: RunPython,
  model: string,
  prompt: string,
  useTools: boolean,
  progress: AgentProgress = {},
): Promise<Recording> {
  const items: Json[] = [{role: 'user', content: prompt}];
  const turns: Turn[] = [];
  const started_at = nowIso();
  const t0 = performance.now();
  for (let i = 0; i < MAX_TURNS; i++) {
    const body: Json = {model, input: [...items], reasoning: {effort: 'low'}, max_output_tokens: 16000};
    if (useTools) body.tools = [TOOL_SPEC];
    progress.request?.(body, i);
    const turn: Turn = {...(await post(RESPONSES_URL, body)), tool_runs: []};
    turns.push(turn);
    progress.response?.(turn, i);
    const output: Json[] = turn.response.body.output;
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) break;
    items.push(...output);
    for (const call of calls) {
      let args: Json | null = null;
      let problem = '';
      try {
        args = JSON.parse(call.arguments);
        if (typeof args!.code !== 'string') throw new Error("'code'");
      } catch (e) {
        problem = (e as Error).message;
      }
      const run: SandboxRun = problem
        ? {started_at: nowIso(), duration_ms: 0, output: `Error: bad arguments (${problem})`}
        : await runPython(args!.code, args!.input ?? null);
      const toolRun = {call_id: call.call_id, arguments: problem ? call.arguments : args!, ...run};
      turn.tool_runs.push(toolRun);
      progress.tool?.(toolRun, i);
      items.push({type: 'function_call_output', call_id: call.call_id, output: run.output});
    }
  }
  return {started_at, total_ms: roundMs(performance.now() - t0), turns};
}

export function finalText(recording: Recording) {
  const output: Json[] = recording.turns[recording.turns.length - 1].response.body.output;
  return output
    .filter(item => item.type === 'message')
    .flatMap(item => item.content)
    .map(part => part.text ?? '')
    .join('');
}

export const entryKey = (optionId: string, modelId: string, mode: Mode) => `${optionId}/${modelId}/${mode}`;
