import json
import time

from flask import Response, jsonify, request

import context_core as core

METHODS = ("stuff", "rag", "agents")
AGENT_SPEEDUP = {"agents": 2}


def replay(events, speed):
    started = time.perf_counter()
    for event in events:
        delay = event["t"] / speed - (time.perf_counter() - started)
        if delay > 0:
            time.sleep(delay)
        yield event


def ndjson(events):
    for event in events:
        yield json.dumps(event, ensure_ascii=False) + "\n"


def register(app):
    @app.get("/api/context")
    def context_config():
        return jsonify(
            limit=core.LIMIT_TOKENS,
            books=core.book_infos(),
            questions=core.QUESTIONS,
            speedup=AGENT_SPEEDUP,
        )

    @app.post("/api/context/run")
    def context_run():
        body = request.get_json(force=True)
        method, question = body.get("method"), body.get("question")
        scope = body.get("scope") if body.get("scope") in ("book", "all") else "book"
        book = body.get("book") if body.get("book") in core.TITLES else core.QUESTIONS[0]["book"]
        if method not in METHODS or not isinstance(question, str) or not question.strip():
            return jsonify(error="bad request"), 400
        data = core.read_data()
        recorded = data["runs"].get(core.recording_key(method, question, scope) or "")
        speedup = 1
        if recorded:
            speedup = AGENT_SPEEDUP.get(method, 1)
            events = replay(recorded["events"], (float(data.get("speed", 1)) or 1.0) * speedup)
        else:
            events = core.timed(core.run_live(method, question, scope, book))
        headers = {"Cache-Control": "no-cache", "X-Speedup": str(speedup)}
        return Response(ndjson(events), mimetype="application/x-ndjson", headers=headers)
