# Simple Tech

Interactive explainers. **Computer:** an 8-bit computer for teaching how CPUs work: 256 bytes of RAM, two
registers, a tiny assembly language, and two demos (Pong, and timer-driven multitasking). **AI:** demo pages
about how language models work, served by a small Flask app in `ai/` (see `ai/README.md`).

## Development

```sh
pnpm install
pnpm dev        # Vite (hot reload) plus the AI Flask server; needs uv
pnpm check      # typecheck, formatting, tests
pnpm build      # static site in dist/; `pnpm preview` serves it with the AI server
```

Vite proxies the AI app's routes (`/api`, `/texts` and everything in `ai/static/`) to Flask on port 8000, and
the sidebar shows those pages in an iframe.

## Layout

```
src/
  machine/     the computer itself, no DOM: assembler, instruction set, CPU, keyboard
  demos/       one folder per demo: program source, memory layout, and its panels
  ui/          shared panels: CPU, RAM grid, program listing, tooltip
  main.ts      wiring: sidebar, view modes, clock, input
ai/            AI explainers (Flask, vanilla JS pages, recorded model answers)
```

To add an instruction, add it to `Op` and `OPS` in `src/machine/isa.ts` and teach `assemble()` its syntax.
To add a demo, add a folder under `src/demos/` exporting a `DemoSetup` and a `DemoView`, register it in
`src/demos/index.ts`, and add its tab to `index.html`.
