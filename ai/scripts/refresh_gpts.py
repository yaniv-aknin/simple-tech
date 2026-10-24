#!/usr/bin/env python3
"""Re-run the GPT demo prompts and save full requests, responses and latencies to data/gpts.json.

    uv run scripts/refresh_gpts.py                    # everything
    uv run scripts/refresh_gpts.py s-m-l/16           # one task/option
    uv run scripts/refresh_gpts.py s-m-l/16/astra     # one model
    uv run scripts/refresh_gpts.py gpt2-markov/tldr/gpt-2 --seed-start=10   # GPT-2 with other seeds

Responses are stored exactly as received; the web app does all formatting. The top-level "speed"
in the JSON is kept; the web app divides replayed latencies by it.
"""
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gpts_core as core  # noqa: E402


def selected(filters):
    for task_id, task in core.TASKS.items():
        for option in task["options"]:
            for model in option["models"]:
                if model.get("client"):
                    continue
                path = f"{task_id}/{option['id']}/{model['id']}"
                if not filters or any(path == f or path.startswith(f + "/") for f in filters):
                    yield task_id, option, model


def main():
    args = sys.argv[1:]
    seed_start = next((int(a.split("=")[1]) for a in args if a.startswith("--seed-start=")), 0)
    jobs = list(selected([a.strip("/") for a in args if not a.startswith("--")]))
    if not jobs:
        sys.exit("nothing matches " + " ".join(sys.argv[1:]))
    data = core.read_data()
    failures = 0

    def run_api(task_id, option, model, run):
        return core.chat(model["api"], option["prompt"], model["params"])

    def run_gpt2(task_id, option, model):
        return core.gpt2(option["prompt"], range(seed_start, seed_start + core.task_runs(core.TASKS[task_id])))

    with ThreadPoolExecutor(max_workers=24) as pool:
        futures = {}
        for task_id, option, model in jobs:
            if model.get("local"):
                futures[pool.submit(run_gpt2, task_id, option, model)] = (task_id, option, model, None)
            else:
                for run in range(core.task_runs(core.TASKS[task_id])):
                    futures[pool.submit(run_api, task_id, option, model, run)] = (task_id, option, model, run)
        for future in as_completed(futures):
            task_id, option, model, run = futures[future]
            label = core.entry_key(task_id, option["id"], model["id"], "*" if run is None else run)
            try:
                result = future.result()
            except Exception as e:
                failures += 1
                print(f"FAILED {label}: {e}")
                continue
            records = result if run is None else [result]
            for i, record in enumerate(records):
                key = core.entry_key(task_id, option["id"], model["id"], i if run is None else run)
                data["entries"][key] = record
                print(f"{key:28} {record['latency_ms'] / 1000:7.1f}s  {core.record_text(record).strip()[:60]!r}")

    data["entries"] = dict(sorted(data["entries"].items()))
    core.write_data(data)
    print(f"saved {core.DATA_FILE}" + (f" ({failures} failed)" if failures else ""))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
