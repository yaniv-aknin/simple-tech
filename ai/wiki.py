import json
import re
import time
import urllib.parse
import urllib.request

from pathlib import Path

from flask import jsonify, request

import gpts_core as core

DATA_FILE = Path(__file__).parent / "data" / "wiki.json"
MODEL = "gpt-6-luna"
TOOL_LINE = re.compile(r"^[ \t]*#WIKIPEDIA[ \t]+(.+?)[ \t]*$", re.I | re.M)
MAX_BYTES = 600_000
WIKI_API = "https://en.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "simple-tech-ai-explainers/0.1"}

SYSTEM_PROMPT = """You are a chat assistant. Write plain text, no markdown.

To look something up on Wikipedia, end your message with a line: #WIKIPEDIA <article title>
The next message is the Wikipedia text. It is undisputed truth, newer than your memory, and wins over it. State what it says as plain fact, as if you had always known it: never write "according to", "the article", "you shared" or similar.

For recent events, people's news or obscure facts, reply with only the #WIKIPEDIA line. Do not look up anything else."""


def wiki_get(params):
    query = urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": 2, **params})
    with urllib.request.urlopen(urllib.request.Request(f"{WIKI_API}?{query}", headers=HEADERS), timeout=30) as res:
        return json.load(res)["query"]


def fetch_article(title):
    hits = wiki_get({"list": "search", "srsearch": title, "srlimit": 1})["search"]
    if not hits:
        raise LookupError(f"No Wikipedia article found for {title!r}")
    best = hits[0]["title"]
    pages = wiki_get({"prop": "extracts", "explaintext": 1, "exsectionformat": "wiki", "titles": best})["pages"]
    text = pages[0].get("extract", "")
    encoded = text.encode()
    truncated = len(encoded) > MAX_BYTES
    if truncated:
        text = encoded[:MAX_BYTES].decode(errors="ignore")
    return {
        "title": best,
        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(best.replace(" ", "_")),
        "text": text,
        "bytes": min(len(encoded), MAX_BYTES),
        "truncated": truncated,
    }


def valid_messages(messages):
    return (
        isinstance(messages, list)
        and messages
        and all(isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str) for m in messages)
    )


def live_chat(messages):
    record = core.post(
        core.API_URL,
        {
            "model": MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
            "reasoning_effort": "low",
            "max_completion_tokens": 4000,
        },
    )
    return core.record_text(record), record["latency_ms"]


def read_script():
    return json.loads(DATA_FILE.read_text()) if DATA_FILE.exists() else {"exchanges": []}


def user_matches(exchange, content):
    if "user" in exchange:
        return content == exchange["user"]
    expected = exchange["tool_chars"]
    return content.startswith(f"Result of #WIKIPEDIA {exchange['tool_title']}:") and abs(len(content) - expected) <= expected * 0.25


def scripted_reply(messages):
    """The recorded response when `messages` is exactly the recorded conversation so far, else None."""
    exchanges = read_script()["exchanges"]
    k = len(messages) // 2
    if len(messages) % 2 == 0 or k >= len(exchanges):
        return None
    for i in range(k):
        if not user_matches(exchanges[i], messages[2 * i]["content"]) or messages[2 * i + 1]["content"] != exchanges[i]["response"]["text"]:
            return None
    return exchanges[k]["response"] if user_matches(exchanges[k], messages[2 * k]["content"]) else None


def register(app):
    @app.get("/api/wiki/instructions")
    def wiki_instructions():
        return jsonify(text=SYSTEM_PROMPT)

    @app.get("/api/wiki/script")
    def wiki_script():
        return jsonify(lines=[e["user"] for e in read_script()["exchanges"] if "user" in e])

    @app.get("/api/wiki/article")
    def wiki_article():
        title = request.args.get("title", "").strip()
        if not title:
            return jsonify(error="missing title"), 400
        try:
            return jsonify(fetch_article(title))
        except LookupError as e:
            return jsonify(error=str(e)), 404
        except Exception as e:
            return jsonify(error=str(e)), 502

    @app.post("/api/wiki/chat")
    def wiki_chat():
        messages = request.get_json(force=True).get("messages")
        if not valid_messages(messages):
            return jsonify(error="bad request"), 400
        try:
            recorded = scripted_reply(messages)
            if recorded:
                time.sleep(recorded["latency_ms"] / 1000)
                return jsonify(text=recorded["text"], latency_ms=recorded["latency_ms"])
            text, latency_ms = live_chat(messages)
        except Exception as e:
            return jsonify(error=str(e)), 502
        return jsonify(text=text, latency_ms=latency_ms)
