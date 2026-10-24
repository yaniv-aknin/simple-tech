# /// script
# requires-python = ">=3.10"
# dependencies = ["flask>=3"]
# ///
import json
import os
from pathlib import Path

from flask import Flask, jsonify, redirect, send_from_directory

import context
import gpts
import wiki

ROOT = Path(__file__).parent
TEXTS = ROOT / "texts"

app = Flask(__name__, static_folder="static", static_url_path="")
gpts.register(app)
context.register(app)
wiki.register(app)


@app.get("/")
def index():
    return redirect("/markov/predict/")


@app.get("/markov/predict/")
def markov_predict():
    return app.send_static_file("markov/predict.html")


@app.get("/markov/build/")
def markov_build():
    return app.send_static_file("markov/build.html")


@app.get("/gpts/2-4-6/")
def gpts_2_4_6():
    return app.send_static_file("gpts/2-4-6.html")


@app.get("/gpts/gpt2-markov/")
def gpts_gpt2_markov():
    return app.send_static_file("gpts/gpt2-markov.html")


@app.get("/gpts/python/")
def gpts_python():
    return app.send_static_file("gpts/python.html")


@app.get("/gpts/context/")
def gpts_context():
    return app.send_static_file("gpts/context.html")


@app.get("/gpts/wikipedia/")
def gpts_wikipedia():
    return app.send_static_file("gpts/wikipedia.html")


@app.get("/gpts/s-m-l-apples/")
def gpts_s_m_l_apples():
    return app.send_static_file("gpts/s-m-l-apples.html")


@app.get("/gpts/s-m-l/")
def gpts_s_m_l():
    return app.send_static_file("gpts/s-m-l.html")


@app.get("/api/books")
def books():
    return jsonify(json.loads((TEXTS / "books.json").read_text(encoding="utf-8")))


@app.get("/texts/<path:name>")
def text(name):
    return send_from_directory(TEXTS, name, mimetype="text/plain")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 8000)))
