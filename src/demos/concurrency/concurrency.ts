import {hex} from '../../machine/format.ts';
import type {DemoSetup} from '../demo.ts';

export const CUR = 0x08;
export const TABLE = 0x10;
export const SLOT_SIZE = 5;
export const PROC0 = 0x38;
export const PROC_SIZE = 24;
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

export function source(n: number) {
  let s = `
; --- KERNEL: runs whenever the timer fires ---
.org 0x00
kernel:
.c k_next
  LOAD A, [CUR]     ; slot of the process that just ran
  LDX A, [4]        ; A = that slot's NEXT field
  STORE [CUR], A    ; the next process is now current
.c k_rti
  RTI               ; load its PC, A, B, flags and carry on
`;
  for (let i = 1; i <= n; i++) {
    s += `
; --- PROCESS ${i} ---
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

export function cSource(n: number) {
  let s = `struct slot *cur;  // RAM 0x08

void kernel(void) {  // runs on every timer tick
    cur = cur->next;                //@k_next
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
    if (off < 22) return procColor(i);
    return '';
  }
  if (a >= TABLE && a < TABLE + SLOT_SIZE * n) {
    return procColor(Math.floor((a - TABLE) / SLOT_SIZE));
  }
  return '';
}

export function concurrencySetup(n: number): DemoSetup {
  const symbols: Record<string, number> = {CUR};
  const names: Record<number, string> = {[CUR]: 'CUR'};
  for (let i = 0; i < n; i++) {
    symbols[`COUNT${i + 1}`] = procBase(i);
    SLOT_FIELDS.forEach((f, j) => {
      names[slotAddr(i) + j] = `P${i + 1}.${f}`;
    });
    names[procBase(i)] = `P${i + 1} counter`;
  }
  return {
    source: source(n),
    cSource: cSource(n),
    symbols,
    names,
    interrupt: {quantum: QUANTUM, curAddr: CUR},
    cellColor: a => cellColor(a, n),
    init(m, program) {
      for (let i = 0; i < n; i++) {
        m.mem[slotAddr(i)] = program.labels['loop' + (i + 1)];
        m.mem[slotAddr(i) + 4] = slotAddr((i + 1) % n);
      }
      m.mem[CUR] = slotAddr(n - 1);
      m.kernel = true;
    },
  };
}
