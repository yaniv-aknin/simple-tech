#!/usr/bin/env python3
"""Build the Dickens search index and record the runs replayed on /gpts/context/.

    uv run scripts/refresh_context.py index                    # embed every chunk into data/dickens.vec
    uv run scripts/refresh_context.py record                   # every question and method
    uv run scripts/refresh_context.py record rag               # one method
    uv run scripts/refresh_context.py record agents barkis     # one method on one question

Recordings keep every event with its time offset, so replay shows the real timings. Needs OPENAI_API_KEY.
A full recording sends about 12M input tokens: the sub-agent runs read all of Dickens once per question.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import context_core as core  # noqa: E402


def record(filters):
    data = core.read_data()
    for question in core.QUESTIONS:
        for method, scope in (("stuff", "book"), ("stuff", "all"), ("rag", "-"), ("agents", "-")):
            if filters and not (method in filters or question["id"] in filters):
                continue
            key = core.recording_key(method, question["text"], scope)
            events = list(core.timed(core.run_live(method, question["text"], scope, question["book"])))
            data["runs"][key] = {"events": events}
            core.write_data(data)
            last = events[-1]
            print(f"{key}: {len(events)} events, {last['t']}s, ends with {last['type']}", flush=True)


if __name__ == "__main__":
    command, *filters = sys.argv[1:] or ["record"]
    if command == "index":
        core.build_index()
    elif command == "record":
        record(set(filters))
    else:
        sys.exit(__doc__)
