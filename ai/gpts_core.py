import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
DATA_FILE = ROOT / "data" / "gpts.json"
GPT2_SCRIPT = ROOT / "scripts" / "gpt2.py"
API_URL = "https://api.openai.com/v1/chat/completions"
RESPONSES_URL = "https://api.openai.com/v1/responses"
RUNS = 5
LIVE_MAZE_TOKENS = 16000
MAX_LIVE_CALLS = int(os.environ.get("MAX_LIVE_CALLS", 200))

APPLES = (
    "I have 3 apples. I eat one, buy five more, then give half of what I have to a friend. "
    "How many apples do I have left? Answer with just the number."
)
GRID_8 = """..#.....
...###..
#.....##
........
......#.
........
.#.##.#.
......#."""

GLORP = (
    "A glorp is a small blue animal that lives in the mountains of Peru. Glorps eat mostly berries. "
    "One morning, a farmer found a glorp."
)
CAPITALS = "France: Paris\nJapan: Tokyo\nKenya: Nairobi\nCanada:"

lock = threading.Lock()
live_calls = 0


def holmes_snippet():
    """The deduction scene from A Scandal in Bohemia in texts/, followed by the TL;DR cue."""
    text = (ROOT / "texts" / "holmes.txt").read_text(encoding="utf-8")
    paragraphs = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return "\n\n".join(paragraphs[3:12]) + "\n\nTL;DR:"


def versus_option(id, title, emoji, prompt, **extra):
    return {
        "id": id,
        "title": title,
        "sub": "",
        "emoji": emoji,
        "prompt": prompt,
        **extra,
        "models": [
            {"id": "gpt-2", "name": "GPT-2", "sub": "reads the whole text", "local": True},
            {
                "id": "markov",
                "name": "Markov chain",
                "sub": "remembers 2 words",
                "client": {"corpus": "holmes.txt", "order": 2},
            },
        ],
    }


def make_grid(n, wall_rate, seed):
    rng = random.Random(seed)
    rows = [
        "".join("#" if (r, c) not in ((0, 0), (n - 1, n - 1)) and rng.random() < wall_rate else "." for c in range(n))
        for r in range(n)
    ]
    return "\n".join(rows)


def count_paths(grid):
    rows = grid.splitlines()
    ways = [[0] * len(rows[0]) for _ in rows]
    ways[0][0] = 1
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == "." and (r, c) != (0, 0):
                ways[r][c] = (ways[r - 1][c] if r else 0) + (ways[r][c - 1] if c else 0)
    return ways[-1][-1]


def maze_prompt(grid):
    n = len(grid.splitlines())
    return (
        f"In this {n}x{n} grid, '#' is a wall and '.' is open. Starting at the top-left cell and moving only "
        f"right or down, how many different paths reach the bottom-right cell?\n{grid}\nAnswer with just the number."
    )


def reasoning(max_tokens):
    return {"reasoning_effort": "low", "max_completion_tokens": max_tokens}


def gpt6_models(max_tokens):
    return [
        {"id": "luna", "name": "Luna", "sub": "small", "api": "gpt-6-luna", "params": reasoning(max_tokens)},
        {"id": "sol", "name": "Sol", "sub": "medium", "api": "gpt-6-sol", "params": reasoning(max_tokens)},
        {"id": "astra", "name": "Astra", "sub": "large", "api": "gpt-6-astra", "params": reasoning(max_tokens)},
    ]


def maze_option(size, grid, max_tokens, **extra):
    return {
        "id": str(size),
        "title": f"{size}×{size} maze",
        "sub": "Count the paths",
        "emoji": "🧩",
        "prompt": maze_prompt(grid),
        "grid": grid,
        "truth": str(count_paths(grid)),
        "models": gpt6_models(max_tokens),
        **extra,
    }


TASKS = {
    "2-4-6": {
        "title": "Then and Now",
        "options": [
            {
                "id": "apples",
                "prompt": APPLES,
                "truth": "3.5",
                "models": [
                    {"id": "gpt-2", "name": "GPT-2", "sub": "2019", "local": True},
                    {"id": "gpt-4", "name": "GPT-4", "sub": "2023", "api": "gpt-4", "params": {"max_tokens": 250}},
                    {"id": "gpt-6", "name": "GPT-6", "sub": "2026", "api": "gpt-6-sol", "params": reasoning(3000)},
                ],
            }
        ],
    },
    "s-m-l-apples": {
        "title": "Size isn't Everything",
        "options": [{"id": "apples", "prompt": APPLES, "truth": "3.5", "models": gpt6_models(3000)}],
    },
    "gpt2-markov": {
        "title": "GPT2 vs Markov",
        "runs": 3,
        "multiline": True,
        "options": [
            versus_option("glorp", "Glorp", "🐾", GLORP),
            versus_option("capitals", "Capitals", "🌍", CAPITALS, compact=True),
            versus_option("tldr", "TL;DR", "🔍", holmes_snippet()),
        ],
    },
    "s-m-l": {
        "title": "Size isn't Everything",
        "options": [
            maze_option(4, make_grid(4, 0.2, seed=8), 4000),
            maze_option(8, GRID_8, 8000, default=True),
            maze_option(16, make_grid(16, 0.2, seed=2), 16000),
        ],
    },
}


def task_runs(task):
    return task.get("runs", RUNS)


def find(task_id, option_id, model_id):
    task = TASKS.get(task_id)
    option = next((o for o in task["options"] if o["id"] == option_id), None) if task else None
    model = next((m for m in option["models"] if m["id"] == model_id), None) if option else None
    return task, option, model


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def load_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    env_file = ROOT.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "OPENAI_API_KEY":
                return value.strip().strip("\"'")
    return None


def post(url, body):
    """POST a JSON body to the OpenAI API. Returns the full request/response record with wall-clock latency."""
    global live_calls
    key = load_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    with lock:
        if live_calls >= MAX_LIVE_CALLS:
            raise RuntimeError(f"Live call limit reached ({MAX_LIVE_CALLS}); restart the server to reset it")
        live_calls += 1
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    started_at = now_iso()
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            status, payload = res.status, json.load(res)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            detail = json.loads(raw).get("error", {}).get("message", e.reason)
        except ValueError:
            detail = e.reason
        raise RuntimeError(f"{body.get('model')}: {detail}") from e
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    return {
        "started_at": started_at,
        "latency_ms": latency_ms,
        "request": {"url": url, "body": body},
        "response": {"status": status, "body": payload},
    }


def chat(model, prompt, params):
    """One chat completion."""
    return post(API_URL, {"model": model, "messages": [{"role": "user", "content": prompt}], **params})


def gpt2(prompt, seeds):
    """GPT-2 runs locally through scripts/gpt2.py (torch and transformers are fetched by uv)."""
    out = subprocess.run(
        ["uv", "run", str(GPT2_SCRIPT)],
        input=json.dumps({"prompt": prompt, "seeds": list(seeds)}),
        capture_output=True,
        text=True,
    )
    if out.returncode:
        raise RuntimeError("GPT-2 failed: " + out.stderr.strip().splitlines()[-1])
    return json.loads(out.stdout)


def record_text(record):
    body = record["response"]["body"]
    if "choices" in body:
        return body["choices"][0]["message"]["content"] or ""
    return body["continuation"]


def read_data():
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"speed": "1.0", "entries": {}}


def write_data(data):
    DATA_FILE.parent.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"speed": data["speed"], "entries": data["entries"]}, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(DATA_FILE)


def entry_key(task_id, option_id, model_id, run):
    return f"{task_id}/{option_id}/{model_id}/{run}"
