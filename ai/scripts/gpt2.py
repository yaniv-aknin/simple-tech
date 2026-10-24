# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "transformers"]
# ///
"""Reads {"prompt": str, "seeds": [int]} on stdin; prints one run record per seed as JSON."""
import json
import sys
import time
from datetime import datetime, timezone

from transformers import pipeline, set_seed
from transformers.utils import logging

logging.set_verbosity_error()

MAX_NEW_TOKENS = 60

job = json.load(sys.stdin)
prompt = job["prompt"]
generator = pipeline("text-generation", model="gpt2")

records = []
for seed in job["seeds"]:
    set_seed(seed)
    started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    t0 = time.perf_counter()
    generated = generator(prompt, max_new_tokens=MAX_NEW_TOKENS, do_sample=True)[0]["generated_text"]
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    records.append({
        "started_at": started_at,
        "latency_ms": latency_ms,
        "request": {
            "url": "local:transformers/gpt2",
            "body": {"model": "gpt2", "prompt": prompt, "max_new_tokens": MAX_NEW_TOKENS, "do_sample": True, "seed": seed},
        },
        "response": {"status": 200, "body": {"generated_text": generated, "continuation": generated[len(prompt):]}},
    })
json.dump(records, sys.stdout)
