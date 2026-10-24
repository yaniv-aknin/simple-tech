import json
import subprocess
import time
import uuid
from pathlib import Path

import gpts_core as core

DATA_FILE = core.ROOT / "data" / "tools.json"
IMAGE = "python:3.13-alpine"
TIME_LIMIT_S = 5
MAX_OUTPUT_CHARS = 10000
MAX_TURNS = 8
MODES = ("plain", "tools")

TOOL_SPEC = {
    "type": "function",
    "name": "run_python",
    "description": (
        "Run Python code in a sandbox with no network and no third-party libraries, stopped after "
        f"{TIME_LIMIT_S} seconds. The code must define main(input); it is called with `input` (a string, or None) "
        "and its return value is returned as a string, after anything the code printed."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "Python source defining main(input)."},
            "input": {"type": ["string", "null"], "description": "Passed to main() as its only argument."},
        },
        "required": ["code"],
    },
}

RUNNER = r"""
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
    out += ("\n" if out and not out.endswith("\n") else "") + str(result)
sys.stdout.write(out)
"""


def docker_command(name):
    return [
        "docker", "run", "--rm", "-i", "--name", name,
        "--network", "none", "--memory", "128m", "--cpus", "1", "--pids-limit", "64",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534",
        IMAGE, "timeout", "-s", "KILL", str(TIME_LIMIT_S), "python", "-I", "-c", RUNNER,
    ]


def run_python(code, input):
    """Run code in a fresh container. Returns what happened, including the string handed back to the model."""
    name = f"models101-{uuid.uuid4().hex[:12]}"
    command = docker_command(name)
    started_at = core.now_iso()
    t0 = time.perf_counter()
    try:
        done = subprocess.run(command, input=json.dumps({"code": code, "input": input}), capture_output=True, text=True, timeout=60)
        exit_code, stdout, stderr = done.returncode, done.stdout, done.stderr
    except subprocess.TimeoutExpired:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        exit_code, stdout, stderr = 137, "", ""
    duration_ms = round((time.perf_counter() - t0) * 1000, 1)
    timed_out = exit_code == 137
    if timed_out:
        output = f"Error: stopped after {TIME_LIMIT_S} seconds"
    elif exit_code:
        output = f"Error (exit code {exit_code}):\n{stderr}{stdout}"
    else:
        output = stdout
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + "\n...(truncated)"
    return {
        "started_at": started_at,
        "duration_ms": duration_ms,
        "container": {"image": IMAGE, "command": command[:-1] + ["<runner>"]},
        "exit_code": exit_code,
        "timed_out": timed_out,
        "stdout": stdout,
        "stderr": stderr,
        "output": output,
    }


def run_agent(model, prompt, use_tools):
    """Responses API loop: call the model, run any run_python calls in Docker, feed results back, repeat."""
    items = [{"role": "user", "content": prompt}]
    turns = []
    started_at = core.now_iso()
    t0 = time.perf_counter()
    for _ in range(MAX_TURNS):
        body = {"model": model, "input": list(items), "reasoning": {"effort": "low"}, "max_output_tokens": 16000}
        if use_tools:
            body["tools"] = [TOOL_SPEC]
        turn = core.post(core.RESPONSES_URL, body)
        turn["tool_runs"] = []
        turns.append(turn)
        output = turn["response"]["body"]["output"]
        calls = [i for i in output if i["type"] == "function_call"]
        if not calls:
            break
        items += output
        for call in calls:
            try:
                arguments = json.loads(call["arguments"])
                run = run_python(arguments["code"], arguments.get("input"))
            except (ValueError, KeyError) as e:
                arguments, run = call["arguments"], {"started_at": core.now_iso(), "duration_ms": 0, "output": f"Error: bad arguments ({e})"}
            turn["tool_runs"].append({"call_id": call["call_id"], "arguments": arguments, **run})
            items.append({"type": "function_call_output", "call_id": call["call_id"], "output": run["output"]})
    return {"started_at": started_at, "total_ms": round((time.perf_counter() - t0) * 1000, 1), "turns": turns}


def final_text(recording):
    body = recording["turns"][-1]["response"]["body"]
    return "".join(
        part.get("text", "") for item in body["output"] if item["type"] == "message" for part in item["content"]
    )


def read_data():
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"speed": "1.0", "entries": {}}


def write_data(data):
    DATA_FILE.parent.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"speed": data["speed"], "entries": data["entries"]}, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(DATA_FILE)


def entry_key(option_id, model_id, mode):
    return f"{option_id}/{model_id}/{mode}"
