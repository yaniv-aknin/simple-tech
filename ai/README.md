# AI explainers

Live demo pages about how language models work, served by one small Flask server.

| Route | What it is |
| --- | --- |
| `/markov/predict/` | Word-level Markov chain text generator with next-word bars |
| `/markov/build/` | The same chain being built, step by step |
| `/gpts/2-4-6/` | Then and Now: one question, five runs each |
| `/gpts/gpt2-markov/` | GPT2 vs Markov: three starting texts (made-up animal, capitals pattern, Sherlock Holmes TL;DR), three runs each; the Markov chain is trained on The Adventures of Sherlock Holmes and runs in the browser |
| `/gpts/python/` | Hey do you have a pen?: the maze problem with and without a `run_python` tool (Docker sandbox), showing every request, response and sandbox run |
| `/gpts/wikipedia/` | GPT6 Luna with a pretend Wikipedia tool: the model just writes `#WIKIPEDIA <title>`, and the page (or you, pasting) supplies the article as the next user turn |
| `/gpts/context/` | Fast Reading Crash Course: one question answered by context stuffing, RAG and sub-agents over all 16 Dickens novels (about 5.6M tokens), with tokens, calls and time for each |
| `/gpts/s-m-l-apples/` | Size isn't Everything: the apples question, five runs each |
| `/gpts/s-m-l/` | Size isn't Everything: maze path counting, five runs each (4×4, 8×8, 16×16) |

The Markov pages run offline. The GPT pages replay saved answers, and call the OpenAI API from the server only for edited questions; the key is read from `OPENAI_API_KEY` or the repo's `.env` and never reaches the browser.

## Run

```
uv run app.py
```

Then open http://127.0.0.1:8000 (set `PORT` to change it). `uv` installs Flask on first run, so run it once with internet; after that no internet is needed. Flask is declared in the script header of `app.py`.

From the repo root, `pnpm dev` runs it together with Simple Tech, which shows these pages in its sidebar.

## Presenting

The pages have no keyboard shortcuts. When embedded in another page, they forward arrow and page keys to it (`static/deck-keys.js`), so a slide deck can drive them.

**Your own text:** pick the last card, paste, click "Learn from this text", then Start. Nothing leaves the browser. To prefill it, put a file at `texts/custom.txt` (gitignored).

## GPT pages

Answers always come from `data/gpts.json`: full request, full response and wall-clock latency for every run. Start shows all runs at once, each appearing after its recorded latency divided by the top-level `"speed"` in the JSON (edit it to speed up or slow down replay; reload the page).

Editing the question (the text on the page, or the whole message in the modal opened by clicking the maze) switches to live requests: the five runs per model go out in parallel and nothing is saved. The expected answer is only shown when it is known (original question, or the original text over an edited grid that parses).

Refresh the saved answers (needs `OPENAI_API_KEY`, from the environment or the repo's `.env`):

```
uv run scripts/refresh_gpts.py                 # everything
uv run scripts/refresh_gpts.py s-m-l/16        # one maze
uv run scripts/refresh_gpts.py s-m-l/16/astra  # one model
```

Responses are stored exactly as received; the web app does all formatting. GPT-2 runs locally through `scripts/gpt2.py` (torch and transformers, fetched by `uv`; its latency excludes model loading). `MAX_LIVE_CALLS` (default 200) caps live API calls per server run.

## Python tool page

`/gpts/python/` replays `data/tools.json` (same top-level `"speed"` as above). Each recording is one model on one maze with code off (`plain`) or on (`tools`), over the Responses API: every request and response, plus every sandbox run (code, input, container command, stdout, stderr, exit code, duration).

```
uv run scripts/refresh_tools.py                 # everything (needs Docker and OPENAI_API_KEY)
uv run scripts/refresh_tools.py 16/luna/tools   # one recording
```

`run_python(code, input)` runs in a fresh `python:3.13-alpine` container: no network, 128 MB, one CPU, read-only filesystem, killed after 5 seconds. The code must define `main(input)`; what it prints, then its return value, goes back to the model.

## Wikipedia tool page

`/gpts/wikipedia/` is a live chat with GPT6 Luna. The system prompt (the "Instructions" button) tells it to end a message with `#WIKIPEDIA <title>` to look something up; the page marks that line green. With "Auto tools" off, copy the article yourself, paste it in the tool input and press Execute. With it on, the page shows the lookup in a zoomed-out Wikipedia frame, "copies" the article (fetched by the server, trimmed at 600 KB) and executes it.

The input is prefilled with a recorded conversation (`data/wiki.json`): Enter, Enter, Enter replays it. Editing anything sends live requests instead. Re-record it (needs `OPENAI_API_KEY`):

```
uv run scripts/refresh_wiki.py
```

## Dickens context page

`/gpts/context/` asks GPT6 Luna one question about Dickens three ways. **Stuffing** sends one whole novel, or all 16 (about 5.6M tokens, over Luna's 922,000 input limit, so the page refuses locally and sends nothing). **RAG** embeds the question, finds the 2 nearest of each novel's passages (23,123 of about 150 words in all, 32 sent), and asks with only those. A second embedding pass over the sentences of those passages shades the best matches on the page. **Sub-agents** run one Luna call per novel (8 at a time), then one call to synthesise the 16 notes.

Two preset questions replay from `data/context.json` (every event with its time offset, same `"speed"` as above). Edit the question and all three methods run live: a sub-agent run reads all of Dickens, about 5.4M input tokens, and can hit the 4M tokens per minute rate limit, so expect retries.

```
uv run scripts/refresh_context.py index                  # embed the chunks into data/dickens.vec (needs OPENAI_API_KEY)
uv run scripts/refresh_context.py record                 # re-record every question and method (about 12M input tokens)
uv run scripts/refresh_context.py record agents barkis   # one method on one question
```

The novels come from `scripts/fetch_texts.py` into `texts/dickens/`.

## Add or replace books

1. Put a cleaned plain-text file in `texts/` (no title page, contents, chapter headings or licence text).
2. Add an entry to `texts/books.json`. The picker shows entries in file order:

   ```json
   {"file": "mybook.txt", "title": "My Book", "author": "Someone", "emoji": "📕"}
   ```

3. Reload the page.

Up to about 250,000 words per book keeps switching under a second. As a safety net, the page strips anything before `*** START OF` and after `*** END OF`, and drops any line mentioning "Project Gutenberg".

## Layout

- `app.py`: Flask server (page routes, `/api/books`, `/texts/<file>`).
- `gpts_core.py`: GPT tasks, OpenAI calls, `data/gpts.json` access. `gpts.py`: its `/api/gpts/...` routes. `scripts/refresh_gpts.py`: refresh utility.
- `wiki.py`: Wikipedia tool page (system prompt, article fetch, chat and replay routes). `scripts/refresh_wiki.py`: re-records its conversation.
- `context_core.py`, `context.py`: Dickens page (chunking, embeddings, the three methods, replay). `scripts/refresh_context.py`: index and recordings.
- `static/`: shared `style.css` and `common.js`; `markov/` and `gpts/` hold each demo's pages and scripts.
- `texts/`: cleaned books and `books.json`.
- `scripts/fetch_texts.py`: re-downloads the Gutenberg books into `raw/` and regenerates `texts/` (`uv run scripts/fetch_texts.py`). Shakespeare is 12 well-known plays with speaker names and stage directions removed.
