#!/usr/bin/env python3
"""Re-record the scripted conversation on /gpts/wikipedia/ into data/wiki.json.

    uv run scripts/refresh_wiki.py

The typed lines below are replayed as written, each answered by the live model. A tool call from the model is
followed by the Wikipedia article as the next user turn. Needs OPENAI_API_KEY.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import wiki  # noqa: E402

AWKWARD = re.compile(r"article|shared|provided|according to|you gave", re.I)
LINES = ["Hi there", "How much is 37.0C in Farenheit?", "What happened to Dolly Parton?"]


def record():
    messages, exchanges = [], []
    queue = list(LINES)
    pending_call = None
    while queue or pending_call:
        if pending_call:
            article = wiki.fetch_article(pending_call)
            content = f"Result of #WIKIPEDIA {pending_call}:\n\n{article['text']}"
            exchange = {"tool_title": pending_call, "tool_chars": len(content)}
            pending_call = None
        else:
            content = queue.pop(0)
            exchange = {"user": content}
        messages.append({"role": "user", "content": content})
        text, latency_ms = wiki.live_chat(messages)
        call = wiki.TOOL_LINE.search(text)
        if call:
            text = text[: call.end()]
            pending_call = call.group(1)
        messages.append({"role": "assistant", "content": text})
        exchanges.append({**exchange, "response": {"text": text, "latency_ms": latency_ms}})
        print(f"{(exchange.get('user') or 'tool result')[:40]!r} -> {text[:70]!r}")
    return exchanges


def main():
    for attempt in range(5):
        exchanges = record()
        if exchanges[-1]["response"]["text"].startswith("#") or not AWKWARD.search(exchanges[-1]["response"]["text"]):
            break
        print("answer mentions its source; retrying")
    wiki.DATA_FILE.write_text(json.dumps({"exchanges": exchanges}, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
