# Simple Tech

Interactive explainers, as a static site. **Computer:** an 8-bit computer for teaching how CPUs work: 256 bytes
of RAM, two registers, a tiny assembly language, and two demos (Pong, and timer-driven multitasking). **AI:** demo
pages about how language models work, replaying recorded model answers.

## Development

```sh
pnpm install
pnpm dev        # dev server with hot reload
pnpm check      # typecheck, formatting, tests
pnpm build      # static site in dist/; `pnpm preview` serves it
```

Pushing to `main` deploys the site to GitHub Pages (`.github/workflows/pages.yml`); in the repository's settings,
set Pages to deploy from GitHub Actions. The site works under any path, so a project page
(`https://<user>.github.io/<repo>/`) needs nothing else.

## Layout

```
index.html          the shell: sidebar and the computer
ai/                 one HTML page per AI explainer, shown in the shell's iframe
src/
  machine/          the computer itself, no DOM: assembler, instruction set, CPU, keyboard
  demos/            one folder per demo: program source, memory layout, and its panels
  ui/               shared panels: CPU, RAM grid, program listing, tooltip
  main.ts           wiring: sidebar, view modes, clock, input
  ai/core/          AI explainer logic, no DOM: tasks, OpenAI calls, Markov chains, Dickens search, Wikipedia tool
  ai/pages/         the AI pages' scripts and styles
public/ai/          recorded answers (data/) and books (texts/)
scripts/            Node tools that re-record public/ai/data/ and re-fetch the books
```

To add an instruction, add it to `Op` and `OPS` in `src/machine/isa.ts` and teach `assemble()` its syntax.
To add a demo, add a folder under `src/demos/` exporting a `DemoSetup` and a `DemoView`, register it in
`src/demos/index.ts`, and add its tab to `index.html`.

## AI explainers

| Page                    | What it is                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai/markov/predict/`    | Word-level Markov chain text generator with next-word bars                                                                                                                        |
| `ai/markov/build/`      | The same chain being built, step by step                                                                                                                                          |
| `ai/gpts/2-4-6/`        | GPT Then and Now: one question, five runs each                                                                                                                                    |
| `ai/gpts/gpt2-markov/`  | GPT2 vs Markov: three starting texts (made-up animal, capitals pattern, Sherlock Holmes TL;DR), three runs each; the Markov chain is trained on The Adventures of Sherlock Holmes |
| `ai/gpts/python/`       | Hey do you have a pen?: the maze problem with and without a `run_python` tool (Docker sandbox), showing every request, response and sandbox run                                   |
| `ai/gpts/wikipedia/`    | GPT6 Luna with a pretend Wikipedia tool: the model just writes `#WIKIPEDIA <title>`, and the page (or you, pasting) supplies the article as the next user turn                    |
| `ai/gpts/context/`      | Fast Reading Crash Course: one question answered by context stuffing, RAG and sub-agents over all 16 Dickens novels (about 5.6M tokens), with tokens, calls and time for each     |
| `ai/gpts/s-m-l-apples/` | Size isn't Everything: the apples question, five runs each                                                                                                                        |
| `ai/gpts/s-m-l/`        | Size isn't Everything: maze path counting, five runs each (4×4, 8×8, 16×16)                                                                                                       |

The Markov pages run entirely in the browser. The other pages replay recordings from `public/ai/data/`: every
request, response and latency, shown after its recorded latency divided by the top-level `"speed"` in each JSON
file.

**Live mode.** Editing a question (or going off-script in the Wikipedia chat) runs it live, from the browser
straight to the OpenAI API. The page asks for an API key and keeps it in the browser's localStorage; while one is
saved, a small grey key icon sits in the bottom-right corner, and clicking it offers to forget the key. GPT-2 and
GPT-4 cannot run live, only replay. Each page makes at most 200 live calls until it is reloaded. A live Dickens
question downloads the novels (26 MB) and, for RAG, the search index (24 MB); a sub-agent run reads all of
Dickens, about 5.4M input tokens, and can hit the 4M tokens per minute rate limit, so expect retries.

**Presenting.** The pages have no keyboard shortcuts. Inside an iframe they forward arrow and page keys to the
parent, so a slide deck can drive them. On the Markov pages, the last card takes your own text: paste, then Start.
Nothing leaves the browser. To prefill it, put a file at `public/ai/texts/custom.txt` (gitignored).

**Mazes and tools.** `run_python(code, input)` must define `main(input)`; what it prints, then its return value,
goes back to the model, and the code is stopped after 5 seconds. The recordings ran it in a fresh
`python:3.13-alpine` container (no network, 128 MB, one CPU, read-only filesystem). Live, it runs in the browser: in
Pyodide (CPython compiled to WebAssembly, about 12 MB from jsDelivr on first use), in a fresh Web Worker per run. The
worker cannot see the page or the saved API key; it is not cut off from the network, and its memory is not capped.
Click the maze to edit the message and run it live.

**Dickens.** **Stuffing** sends one whole novel, or all 16 (over Luna's 922,000 token limit, so the page refuses
locally and sends nothing). **RAG** embeds the question, finds the 2 nearest of each novel's passages (23,123 of
about 150 words in all, 32 sent), and asks with only those; a second embedding pass over the sentences of those
passages shades the best matches. **Sub-agents** run one Luna call per novel (8 at a time), then one call to
synthesise the 16 notes.

### Re-recording

The scripts read `OPENAI_API_KEY` from the environment or from `.env` in the repo root, and save responses exactly
as received. `MAX_LIVE_CALLS` (default 200) caps API calls per run. GPT-2 and GPT-4 recordings are kept as they are.

```sh
node scripts/refresh-gpts.ts                    # every GPT page
node scripts/refresh-gpts.ts s-m-l/16/astra     # one model on one maze
node scripts/refresh-tools.ts                   # the Python tool page (needs Docker)
node scripts/refresh-tools.ts 16/luna/tools     # one recording
node scripts/refresh-wiki.ts                    # the Wikipedia chat script
node scripts/refresh-context.ts index           # embed the Dickens passages into dickens.vec
node scripts/refresh-context.ts record          # every Dickens question and method (about 12M input tokens)
node scripts/refresh-context.ts record agents barkis
node scripts/fetch-texts.ts                     # re-download the books into raw/ and clean them into public/ai/texts/
```

Re-fetching the books can change them, as Gutenberg revises its texts; after changing the Dickens novels, rebuild
the index.

### Adding books

Put a cleaned plain-text file in `public/ai/texts/` (no title page, contents, chapter headings or licence text) and
add it to `BOOKS` in `src/ai/pages/shared/books.ts`. Up to about 250,000 words per book keeps switching under a
second. As a safety net, the pages strip anything before `*** START OF` and after `*** END OF`, and drop any line
mentioning "Project Gutenberg".
