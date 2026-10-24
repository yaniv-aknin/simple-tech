import json
import queue
import re
import time
from array import array
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from operator import mul
from pathlib import Path

import gpts_core as core

ROOT = Path(__file__).parent
TEXTS = ROOT / "texts" / "dickens"
VECTORS = ROOT / "data" / "dickens.vec"
INDEX_META = ROOT / "data" / "dickens_index.json"
DATA_FILE = ROOT / "data" / "context.json"

MODEL = "gpt-6-luna"
EMBED_MODEL = "text-embedding-3-small"
EMBED_URL = "https://api.openai.com/v1/embeddings"
DIMS = 256
EMBED_BATCH = 200
LIMIT_TOKENS = 922_000
CHARS_PER_TOKEN = 3.85
CHUNK_WORDS = 150
PER_BOOK = 2
AGENT_WORKERS = 8

BOOKS = [
    ("pickwick-papers", "The Pickwick Papers"),
    ("oliver-twist", "Oliver Twist"),
    ("nicholas-nickleby", "Nicholas Nickleby"),
    ("old-curiosity-shop", "The Old Curiosity Shop"),
    ("barnaby-rudge", "Barnaby Rudge"),
    ("martin-chuzzlewit", "Martin Chuzzlewit"),
    ("christmas-carol", "A Christmas Carol"),
    ("dombey-and-son", "Dombey and Son"),
    ("david-copperfield", "David Copperfield"),
    ("bleak-house", "Bleak House"),
    ("hard-times", "Hard Times"),
    ("little-dorrit", "Little Dorrit"),
    ("tale-of-two-cities", "A Tale of Two Cities"),
    ("great-expectations", "Great Expectations"),
    ("our-mutual-friend", "Our Mutual Friend"),
    ("edwin-drood", "The Mystery of Edwin Drood"),
]
TITLES = dict(BOOKS)

QUESTIONS = [
    {"id": "poor-rich", "text": "Explain briefly how Dickens portray the poor versus the rich?", "book": "bleak-house"},
    {"id": "barkis", "text": "In which novel does a character say \"Barkis is willin'\", and what does it mean?", "book": "david-copperfield"},
]

STYLE = "Answer in at most {words} words, plain text, no markdown."


def estimate_tokens(chars):
    return round(chars / CHARS_PER_TOKEN)


def book_text(slug):
    return (TEXTS / f"{slug}.txt").read_text(encoding="utf-8")


def labelled(slug):
    return f"=== {TITLES[slug]} ===\n{book_text(slug)}"


def book_infos():
    infos = []
    for slug, title in BOOKS:
        chars = (TEXTS / f"{slug}.txt").stat().st_size
        infos.append({"slug": slug, "title": title, "tokens": estimate_tokens(chars)})
    return infos


def complete(prompt):
    """One Luna call with retries on rate limits. Returns text, token counts and latency."""
    for attempt in range(5):
        try:
            record = core.post(
                core.API_URL,
                {
                    "model": MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "reasoning_effort": "low",
                    "max_completion_tokens": 2000,
                },
            )
            break
        except RuntimeError as e:
            if "rate limit" not in str(e).lower() or attempt == 4:
                raise
            time.sleep(15 * (attempt + 1))
    usage = record["response"]["body"]["usage"]
    return {
        "text": core.record_text(record),
        "prompt_tokens": usage["prompt_tokens"],
        "completion_tokens": usage["completion_tokens"],
        "latency_ms": record["latency_ms"],
    }


def embed(texts):
    vectors = []
    for i in range(0, len(texts), EMBED_BATCH):
        record = core.post(EMBED_URL, {"model": EMBED_MODEL, "input": texts[i : i + EMBED_BATCH], "dimensions": DIMS})
        vectors.extend(d["embedding"] for d in record["response"]["body"]["data"])
    return vectors


SENTENCE = re.compile(r"""\S.*?[.!?]["”’']*(?=\s|$)|\S.+$""", re.S)
ABBREVIATION = re.compile(r"\b(?:Mr|Mrs|Dr|St|Ms)\.$")


def sentences(text):
    out = []
    for piece in SENTENCE.findall(text):
        if out and ABBREVIATION.search(out[-1]):
            out[-1] += " " + piece
        else:
            out.append(piece)
    return out


@lru_cache(maxsize=1)
def chunks():
    """(slug, text) pairs of about CHUNK_WORDS words, split on sentence boundaries."""
    out = []
    for slug, _ in BOOKS:
        current, words = "", 0
        for paragraph in re.split(r"\n\s*\n", book_text(slug)):
            for i, sentence in enumerate(sentences(paragraph.strip())):
                current += ("" if not current else "\n\n" if i == 0 else " ") + sentence
                words += len(sentence.split())
                if words >= CHUNK_WORDS:
                    out.append((slug, current))
                    current, words = "", 0
        if current:
            out.append((slug, current))
    return out


def build_index():
    texts = [text for _, text in chunks()]
    vectors = array("f")
    for i in range(0, len(texts), EMBED_BATCH * 5):
        for vector in embed(texts[i : i + EMBED_BATCH * 5]):
            vectors.extend(vector)
        print(f"embedded {min(i + EMBED_BATCH * 5, len(texts))}/{len(texts)}", flush=True)
    VECTORS.parent.mkdir(exist_ok=True)
    VECTORS.write_bytes(vectors.tobytes())
    INDEX_META.write_text(json.dumps({"model": EMBED_MODEL, "dims": DIMS, "chunks": len(texts)}) + "\n")


@lru_cache(maxsize=1)
def vectors():
    meta = json.loads(INDEX_META.read_text())
    if meta["chunks"] != len(chunks()) or meta["dims"] != DIMS:
        raise RuntimeError("data/dickens.vec is out of date; run scripts/refresh_context.py index")
    data = array("f")
    data.frombytes(VECTORS.read_bytes())
    return data


def search(query_vector, per_book):
    """The best `per_book` passages of each novel, in book order."""
    data = vectors()
    best = {slug: [] for slug, _ in BOOKS}
    for i, (slug, _) in enumerate(chunks()):
        best[slug].append((sum(map(mul, query_vector, data[i * DIMS : (i + 1) * DIMS])), i))
    return [hit for slug, _ in BOOKS for hit in sorted(best[slug], reverse=True)[:per_book]]


def run_stuff(question, scope, book):
    slugs = [slug for slug, _ in BOOKS] if scope == "all" else [book]
    text = "\n\n".join(labelled(slug) for slug in slugs)
    tokens = estimate_tokens(len(text))
    yield {"type": "start", "tokens": tokens, "books": len(slugs)}
    if tokens > LIMIT_TOKENS:
        yield {
            "type": "error",
            "message": f"Input is about {tokens:,} tokens; the model accepts at most {LIMIT_TOKENS:,}. Request not sent.",
        }
        return
    try:
        result = complete(f"{text}\n\n---\n{question}\n{STYLE.format(words=120)}")
    except RuntimeError as e:
        yield {"type": "error", "message": str(e)}
        return
    yield {"type": "answer", **result, "calls": 1}


def sentence_scores(query_vector, texts):
    """Second embedding pass: score every sentence of the retrieved passages against the question."""
    pieces = [sentences(text) for text in texts]
    flat = embed([s for piece in pieces for s in piece])
    scores = iter(sum(map(mul, query_vector, vector)) for vector in flat)
    return [[{"text": s, "score": round(next(scores), 3)} for s in piece] for piece in pieces]


def run_rag(question):
    yield {"type": "embedding", "query": question}
    started = time.perf_counter()
    query_vector = embed([question])[0]
    hits = search(query_vector, PER_BOOK)
    all_chunks = chunks()
    ms = round((time.perf_counter() - started) * 1000)
    highlighted = sentence_scores(query_vector, [all_chunks[i][1] for _, i in hits])
    yield {
        "type": "retrieved",
        "query": question,
        "searched": len(all_chunks),
        "per_book": PER_BOOK,
        "ms": ms,
        "chunks": [
            {"book": TITLES[all_chunks[i][0]], "score": round(score, 3), "text": all_chunks[i][1], "sentences": sents}
            for (score, i), sents in zip(hits, highlighted)
        ],
    }
    excerpts = "\n\n".join(f"[{TITLES[all_chunks[i][0]]}]\n{all_chunks[i][1]}" for _, i in hits)
    result = complete(
        f"Excerpts from Dickens' novels:\n\n{excerpts}\n\n---\n{question}\n"
        f"Answer from the excerpts. {STYLE.format(words=120)}"
    )
    yield {"type": "answer", **result, "calls": 2}


def run_agents(question):
    yield {"type": "plan", "books": book_infos()}
    events = queue.Queue()

    def work(slug):
        events.put({"type": "agent", "slug": slug, "state": "start"})
        try:
            result = complete(
                f"{labelled(slug)}\n\n---\nAbout this novel only: {question}\n"
                f"If it does not address this, say so in one sentence. {STYLE.format(words=80)}"
            )
        except Exception as e:
            events.put({"type": "agent", "slug": slug, "state": "error", "message": str(e)})
            return
        events.put({"type": "agent", "slug": slug, "state": "done", **result})

    notes, total_tokens = {}, 0
    with ThreadPoolExecutor(max_workers=AGENT_WORKERS) as pool:
        for slug, _ in BOOKS:
            pool.submit(work, slug)
        pending = len(BOOKS)
        while pending:
            event = events.get()
            yield event
            if event["state"] != "start":
                pending -= 1
                notes[event["slug"]] = event.get("text", "(failed)")
                total_tokens += event.get("prompt_tokens", 0) + event.get("completion_tokens", 0)
    yield {"type": "synthesis"}
    summary = "\n\n".join(f"{TITLES[slug]}: {notes[slug]}" for slug, _ in BOOKS)
    result = complete(
        f"Question: {question}\n\nNotes from reading each of Dickens' novels separately:\n\n{summary}\n\n---\n"
        f"Combine the notes into one answer to the question. {STYLE.format(words=150)}"
    )
    total_tokens += result["prompt_tokens"] + result["completion_tokens"]
    yield {"type": "answer", **result, "calls": len(BOOKS) + 1, "total_tokens": total_tokens}


def run_live(method, question, scope, book):
    if method == "stuff":
        return run_stuff(question, scope, book)
    if method == "rag":
        return run_rag(question)
    return run_agents(question)


def timed(events):
    started = time.perf_counter()
    try:
        for event in events:
            yield {**event, "t": round(time.perf_counter() - started, 3)}
    except Exception as e:
        yield {"type": "error", "message": str(e), "t": round(time.perf_counter() - started, 3)}


def recording_key(method, question, scope):
    preset = next((q for q in QUESTIONS if q["text"] == question), None)
    return f"{method}|{preset['id']}|{scope if method == 'stuff' else '-'}" if preset else None


def read_data():
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text())
    return {"speed": "1.0", "runs": {}}


def write_data(data):
    DATA_FILE.parent.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(DATA_FILE)
