import {nowIso, roundMs} from '../../core/openai.ts';
import {TIME_LIMIT_S, sandboxOutput, type SandboxRun} from '../../core/tools.ts';
import {PYODIDE_VERSION} from './pyodide-version.ts';

const SANDBOX = `fresh Pyodide ${PYODIDE_VERSION} worker`;

interface Exit {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A worker with Python loaded; `ready` rejects if Pyodide cannot load. */
function spawn() {
  const worker = new Worker(new URL('./python.worker.ts', import.meta.url), {type: 'module'});
  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = e => (e.data.ready ? resolve() : reject(new Error(e.data.failed)));
    worker.onerror = e => reject(new Error(e.message || 'the Python worker failed to start'));
  });
  ready.catch(() => worker.terminate());
  return {worker, ready};
}

let spare: ReturnType<typeof spawn> | null = null;

/** Start loading Python now, so the first run does not wait for it. */
export function warmUp() {
  spare ??= spawn();
}

/**
 * Run code in a fresh Pyodide worker, ended after TIME_LIMIT_S like the Docker sandbox. Each run takes the
 * spare worker and starts the next one loading.
 */
export async function runPython(code: string, input: string | null): Promise<SandboxRun> {
  const {worker, ready} = spare ?? spawn();
  spare = spawn();
  try {
    await ready;
  } catch (e) {
    return {
      started_at: nowIso(),
      duration_ms: 0,
      sandbox: SANDBOX,
      output: `Error: Python failed to load (${(e as Error).message})`,
    };
  }
  const started_at = nowIso();
  const t0 = performance.now();
  const {exitCode, stdout, stderr} = await new Promise<Exit>(resolve => {
    const timer = setTimeout(() => resolve({exitCode: 137, stdout: '', stderr: ''}), TIME_LIMIT_S * 1000);
    worker.onmessage = e => {
      clearTimeout(timer);
      resolve(e.data);
    };
    worker.postMessage({code, input});
  });
  worker.terminate();
  return {
    started_at,
    duration_ms: roundMs(performance.now() - t0),
    exit_code: exitCode,
    timed_out: exitCode === 137,
    stdout,
    stderr,
    sandbox: SANDBOX,
    output: sandboxOutput(exitCode, stdout, stderr),
  };
}
