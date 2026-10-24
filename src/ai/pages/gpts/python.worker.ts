import {PYODIDE_URL} from './pyodide-version.ts';

/** The same contract as the Docker sandbox: define main(input); what it prints, then its return value. */
const RUNNER = `
import contextlib, io, json, traceback

def run(code, input):
    namespace = {"__name__": "sandbox"}
    printed = io.StringIO()
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(code, "<code>", "exec"), namespace)
            if "main" not in namespace:
                raise SystemExit("the code must define main(input)")
            result = namespace["main"](input)
    except SystemExit as e:
        if e.code is None or isinstance(e.code, int):
            return json.dumps({"exitCode": e.code or 0, "stdout": "", "stderr": ""})
        return json.dumps({"exitCode": 1, "stdout": "", "stderr": f"{e.code}\\n"})
    except BaseException:
        return json.dumps({"exitCode": 1, "stdout": "", "stderr": traceback.format_exc()})
    out = printed.getvalue()
    if result is not None:
        out += ("\\n" if out and not out.endswith("\\n") else "") + str(result)
    return json.dumps({"exitCode": 0, "stdout": out, "stderr": ""})
`;

interface Pyodide {
  runPython(code: string): unknown;
  setStdin(options: {error: boolean}): void;
  globals: {get(name: string): (...args: unknown[]) => string};
}

try {
  const {loadPyodide} = await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs');
  const pyodide: Pyodide = await loadPyodide({indexURL: PYODIDE_URL});
  pyodide.setStdin({error: true});
  pyodide.runPython(RUNNER);
  const run = pyodide.globals.get('run');
  self.onmessage = (e: MessageEvent<{code: string; input: string | null}>) =>
    self.postMessage(JSON.parse(run(e.data.code, e.data.input ?? undefined)));
  self.postMessage({ready: true});
} catch (e) {
  self.postMessage({failed: (e as Error).message});
}
