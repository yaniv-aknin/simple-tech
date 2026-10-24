# Simple Tech

An interactive 8-bit computer for teaching how CPUs work: 256 bytes of RAM, two registers, a tiny assembly
language, and two demos (Pong, and timer-driven multitasking).

## Development

```sh
pnpm install
pnpm dev        # dev server with hot reload
pnpm check      # typecheck, formatting, tests
pnpm build      # static site in dist/
```

## Layout

```
src/
  machine/     the computer itself, no DOM: assembler, instruction set, CPU, keyboard
  demos/       one folder per demo: program source, memory layout, and its panels
  ui/          shared panels: CPU, RAM grid, program listing, tooltip
  main.ts      wiring: tabs, view modes, clock, input
```

To add an instruction, add it to `Op` and `OPS` in `src/machine/isa.ts` and teach `assemble()` its syntax.
To add a demo, add a folder under `src/demos/` exporting a `DemoSetup` and a `DemoView`, register it in
`src/demos/index.ts`, and add its tab to `index.html`.
