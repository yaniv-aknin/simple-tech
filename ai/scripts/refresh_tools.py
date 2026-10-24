#!/usr/bin/env python3
"""Re-run the Python-tool maze demo and save full transcripts to data/tools.json.

    uv run scripts/refresh_tools.py                 # every maze, model and mode
    uv run scripts/refresh_tools.py 16              # one maze
    uv run scripts/refresh_tools.py 16/luna/tools   # one recording

Each recording holds every request and response on the wire, plus every sandbox run (code, input,
container command, stdout, stderr, exit code, duration) and latencies. Needs Docker and OPENAI_API_KEY.
"""
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gpts_core as core  # noqa: E402
import tools_core as tools  # noqa: E402

OPTIONS = core.TASKS["s-m-l"]["options"]


def selected(filters):
    for option in OPTIONS:
        for model in option["models"]:
            for mode in tools.MODES:
                path = tools.entry_key(option["id"], model["id"], mode)
                if not filters or any(path == f or path.startswith(f + "/") for f in filters):
                    yield option, model, mode


def main():
    jobs = list(selected([a.strip("/") for a in sys.argv[1:]]))
    if not jobs:
        sys.exit("nothing matches " + " ".join(sys.argv[1:]))
    data = tools.read_data()
    failures = 0
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {
            pool.submit(tools.run_agent, model["api"], option["prompt"], mode == "tools"): (option, model, mode)
            for option, model, mode in jobs
        }
        for future in as_completed(futures):
            option, model, mode = futures[future]
            key = tools.entry_key(option["id"], model["id"], mode)
            try:
                recording = future.result()
            except Exception as e:
                failures += 1
                print(f"FAILED {key}: {e}")
                continue
            data["entries"][key] = recording
            runs = sum(len(t["tool_runs"]) for t in recording["turns"])
            answer = tools.final_text(recording).strip()
            mark = "ok " if answer == option["truth"] else "BAD"
            print(f"{key:22} {mark} {recording['total_ms'] / 1000:6.1f}s  {len(recording['turns'])} turns, {runs} sandbox runs  -> {answer[:40]!r}")
    data["entries"] = dict(sorted(data["entries"].items()))
    tools.write_data(data)
    print(f"saved {tools.DATA_FILE}" + (f" ({failures} failed)" if failures else ""))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
