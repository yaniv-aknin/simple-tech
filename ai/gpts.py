from flask import jsonify, request

import gpts_core as core
import tools_core


def speed_of(data):
    try:
        speed = float(data.get("speed", 1))
    except (TypeError, ValueError):
        return 1.0
    return speed if speed > 0 else 1.0


def saved_runs(data, task_id, option_id, model_id, count):
    runs = []
    for run in range(count):
        record = data["entries"].get(core.entry_key(task_id, option_id, model_id, run))
        runs.append(
            {"text": core.record_text(record), "latency_ms": record["latency_ms"]} if record else {"missing": True}
        )
    return runs


def public_model(task_id, task, option, m, data):
    count = core.task_runs(task)
    runs = [{"client": True}] * count if m.get("client") else saved_runs(data, task_id, option["id"], m["id"], count)
    return {
        "id": m["id"],
        "name": m["name"],
        "sub": m["sub"],
        "local": bool(m.get("local")),
        "client": m.get("client"),
        "runs": runs,
    }


def public_option(task_id, task, option, data):
    public = {k: option[k] for k in ("id", "title", "sub", "emoji", "prompt", "grid", "truth", "compact", "script", "default") if k in option}
    public["models"] = [public_model(task_id, task, option, m, data) for m in option["models"]]
    return public


def live_params(task_id, model):
    if task_id == "s-m-l":
        return {**model["params"], "max_completion_tokens": core.LIVE_MAZE_TOKENS}
    return model["params"]


def register(app):
    @app.get("/api/gpts/<task_id>")
    def gpts_task(task_id):
        task = core.TASKS.get(task_id)
        if not task:
            return jsonify(error="unknown task"), 404
        data = core.read_data()
        return jsonify(
            title=task["title"],
            speed=speed_of(data),
            multiline=bool(task.get("multiline")),
            options=[public_option(task_id, task, o, data) for o in task["options"]],
        )

    @app.get("/api/tools")
    def tools_page():
        data = tools_core.read_data()
        options = []
        recorded = {key.split("/")[0] for key in data["entries"]}
        for o in core.TASKS["s-m-l"]["options"]:
            if o["id"] not in recorded:
                continue
            public = {k: o[k] for k in ("id", "title", "sub", "emoji", "prompt", "grid", "truth")}
            public["models"] = [
                {
                    "id": m["id"],
                    "name": m["name"],
                    "sub": m["sub"],
                    "recordings": {
                        mode: data["entries"].get(tools_core.entry_key(o["id"], m["id"], mode)) for mode in tools_core.MODES
                    },
                }
                for m in o["models"]
            ]
            options.append(public)
        return jsonify(speed=speed_of(data), image=tools_core.IMAGE, limit_s=tools_core.TIME_LIMIT_S, options=options)

    @app.post("/api/gpts/live")
    def gpts_live():
        body = request.get_json(force=True)
        task, option, model = core.find(body.get("task"), body.get("option"), body.get("model"))
        prompt = body.get("prompt")
        if not model or model.get("client") or not isinstance(prompt, str) or not prompt.strip():
            return jsonify(error="bad request"), 400
        try:
            if model.get("local"):
                records = core.gpt2(prompt, range(core.task_runs(task)))
                return jsonify(runs=[{"text": core.record_text(r), "latency_ms": r["latency_ms"]} for r in records])
            record = core.chat(model["api"], prompt, live_params(body["task"], model))
        except Exception as e:
            return jsonify(error=str(e)), 502
        return jsonify(text=core.record_text(record), latency_ms=record["latency_ms"])
