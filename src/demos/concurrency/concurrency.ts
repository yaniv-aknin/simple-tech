import {hex} from '../../machine/format.ts';
import type {DemoSetup} from '../demo.ts';

/** Each core has a kernel of KERNEL_SIZE bytes from 0x00, then a CUR pointer; the process table follows. */
export const KERNEL_SIZE = 8;
export const CUR = 0x20;
export const TABLE = 0x28;
export const SLOT_SIZE = 5;
export const PROC0 = 0x50;
export const PROC_SIZE = 16;
export const QUANTUM = 10;
export const PROC_HUES = [205, 335, 40, 130, 275, 10, 175, 70];

/** A process's colour: `strong` for its counter, else for its code and slot. */
export const procColor = (i: number, strong = false) =>
  strong
    ? `light-dark(hsl(${PROC_HUES[i]} 65% 55%), hsl(${PROC_HUES[i]} 65% 42%))`
    : `light-dark(hsl(${PROC_HUES[i]} 50% 85%), hsl(${PROC_HUES[i]} 45% 27%))`;

export const procBase = (i: number) => PROC0 + PROC_SIZE * i;
export const slotAddr = (i: number) => TABLE + SLOT_SIZE * i;
export const SLOT_FIELDS = ['PC', 'A', 'B', 'FLAGS', 'NEXT'];

/** Each process stays on one core, which shares out its time between its own processes. */
export const coreOf = (i: number, cores: number) => i % cores;
export const curAddr = (core: number) => CUR + core;
const curName = (core: number, cores: number) => (cores === 1 ? 'CUR' : `CUR${core + 1}`);
const kernelAddr = (core: number) => KERNEL_SIZE * core;

/** The processes on a core, in the order its kernel visits them. */
const ring = (core: number, n: number, cores: number) =>
  Array.from({length: n}, (_, i) => i).filter(i => coreOf(i, cores) === core);

export function source(n: number, cores = 1) {
  let s = '';
  for (let k = 0; k < cores; k++) {
    const cur = curName(k, cores);
    const where = cores === 1 ? 'whenever the timer fires' : `whenever core ${k + 1}'s timer fires`;
    s +=
      k < n
        ? `
; --- KERNEL${cores === 1 ? '' : ` ${k + 1}`}: runs ${where} ---
.org ${kernelAddr(k)}
kernel${k + 1}:
.c k_next
  LOAD A, [${cur}]${' '.repeat(8 - cur.length)}; slot of the process that just ran
  LDX A, [4]        ; A = that slot's NEXT field
  STORE [${cur}], A${' '.repeat(7 - cur.length)}; the next process is now current
.c k_rti
  RTI               ; load its PC, A, B, flags and carry on
`
        : `
; --- CORE ${k + 1} has no process to run ---
.org ${kernelAddr(k)}
idle${k + 1}:
  JMP idle${k + 1}
`;
  }
  for (let i = 1; i <= n; i++) {
    s += `
; --- PROCESS ${i}${cores === 1 ? '' : ` (core ${coreOf(i - 1, cores) + 1})`} ---
.org ${procBase(i - 1) + 2}
loop${i}:
.c inc${i}
  LOAD A, [COUNT${i}]
  INC A               ; 255 + 1 wraps around to 0
  STORE [COUNT${i}], A
  JMP loop${i}
`;
  }
  return s;
}

export function cSource(n: number, cores = 1) {
  let s =
    cores === 1
      ? `struct slot *cur;  // RAM ${hex(CUR)}

void kernel(void) {  // runs on every timer tick
    cur = cur->next;                //@k_next
    return_from_interrupt();        //@k_rti
}
`
      : `struct slot *cur[${cores}];  // RAM ${hex(CUR)}, one per core

void kernel(int core) {  // runs on every timer tick of that core
    cur[core] = cur[core]->next;    //@k_next
    return_from_interrupt();        //@k_rti
}
`;
  for (let i = 1; i <= n; i++) {
    s += `
uint8_t count${i};  // RAM ${hex(procBase(i - 1))}

void process${i}(void) {
    for (;;) {
        count${i} = count${i} + 1;   //@inc${i}
    }
}
`;
  }
  return s;
}

function cellColor(a: number, n: number) {
  if (a >= PROC0 && a < PROC0 + PROC_SIZE * n) {
    const i = Math.floor((a - PROC0) / PROC_SIZE);
    const off = (a - PROC0) % PROC_SIZE;
    if (off < 1) return procColor(i, true);
    if (off < PROC_SIZE - 2) return procColor(i);
    return '';
  }
  if (a >= TABLE && a < TABLE + SLOT_SIZE * n) {
    return procColor(Math.floor((a - TABLE) / SLOT_SIZE));
  }
  return '';
}

export function concurrencySetup(n: number, cores = 1): DemoSetup {
  const symbols: Record<string, number> = {};
  const names: Record<number, string> = {};
  for (let k = 0; k < cores; k++) {
    symbols[curName(k, cores)] = curAddr(k);
    names[curAddr(k)] = curName(k, cores);
  }
  for (let i = 0; i < n; i++) {
    symbols[`COUNT${i + 1}`] = procBase(i);
    SLOT_FIELDS.forEach((f, j) => {
      names[slotAddr(i) + j] = `P${i + 1}.${f}`;
    });
    names[procBase(i)] = `P${i + 1} counter`;
  }
  const timer = (k: number) => ({quantum: QUANTUM, curAddr: curAddr(k), vector: kernelAddr(k)});
  return {
    source: source(n, cores),
    cSource: cSource(n, cores),
    symbols,
    names,
    interrupt: timer(0),
    moreCores: Array.from({length: cores - 1}, (_, j) => {
      const k = j + 1;
      return k < n
        ? {interrupt: timer(k), start: kernelAddr(k), kernel: true}
        : {start: kernelAddr(k), kernel: false};
    }),
    kernelEnd: PROC0,
    cellColor: a => cellColor(a, n),
    init(machines, program) {
      const mem = machines[0].mem;
      for (let i = 0; i < n; i++) {
        const mine = ring(coreOf(i, cores), n, cores);
        mem[slotAddr(i)] = program.labels['loop' + (i + 1)];
        mem[slotAddr(i) + 4] = slotAddr(mine[(mine.indexOf(i) + 1) % mine.length]);
      }
      for (let k = 0; k < Math.min(cores, n); k++) {
        mem[curAddr(k)] = slotAddr(ring(k, n, cores).at(-1)!);
      }
      machines[0].kernel = true;
    },
  };
}
