import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {nowIso, roundMs} from '../src/ai/core/openai.ts';
import {IMAGE, TIME_LIMIT_S, sandboxOutput, type SandboxRun} from '../src/ai/core/tools.ts';

const RUNNER = `
import contextlib, io, json, sys
job = json.load(sys.stdin)
namespace = {"__name__": "sandbox"}
printed = io.StringIO()
with contextlib.redirect_stdout(printed):
    exec(compile(job["code"], "<code>", "exec"), namespace)
    if "main" not in namespace:
        raise SystemExit("the code must define main(input)")
    result = namespace["main"](job["input"])
out = printed.getvalue()
if result is not None:
    out += ("\\n" if out and not out.endswith("\\n") else "") + str(result)
sys.stdout.write(out)
`;

const dockerCommand = (name: string) => [
  'docker', 'run', '--rm', '-i', '--init', '--name', name,
  '--network', 'none', '--memory', '128m', '--cpus', '1', '--pids-limit', '64',
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534',
  IMAGE, 'timeout', '-s', 'KILL', String(TIME_LIMIT_S), 'python', '-I', '-c', RUNNER,
]; // prettier-ignore

type Exit = {exitCode: number; stdout: string; stderr: string; killed: boolean};

function docker(command: string[], stdin: string): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {timeout: 60_000, killSignal: 'SIGKILL'});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({exitCode: code ?? 137, stdout, stderr, killed: !!signal}));
    child.stdin.end(stdin);
  });
}

/** Run code in a fresh container. Returns what happened, including the string handed back to the model. */
export async function runPython(code: string, input: string | null): Promise<SandboxRun> {
  const name = `sandbox-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const command = dockerCommand(name);
  const started_at = nowIso();
  const t0 = performance.now();
  let {exitCode, stdout, stderr, killed} = await docker(command, JSON.stringify({code, input}));
  if (killed) {
    spawnSync('docker', ['rm', '-f', name]);
    [exitCode, stdout, stderr] = [137, '', ''];
  }
  const duration_ms = roundMs(performance.now() - t0);
  const timed_out = exitCode === 137;
  const output = sandboxOutput(exitCode, stdout, stderr);
  return {
    started_at,
    duration_ms,
    container: {image: IMAGE, command: [...command.slice(0, -1), '<runner>']},
    exit_code: exitCode,
    timed_out,
    stdout,
    stderr,
    output,
  };
}
