import {hex} from './format.ts';
import type {Machine} from './machine.ts';

export const Op = {
  NOP: 0,
  LOAD_A: 1,
  STORE: 2,
  LDI_A: 3,
  LOAD_B: 4,
  LDI_B: 5,
  ADD: 6,
  SUB: 7,
  JMP: 8,
  JZ: 9,
  JN: 10,
  LDX_A: 11,
  RTI: 12,
} as const;

export type Namer = (addr: number) => string;

export interface OpSpec {
  name: string;
  syntax: string;
  does: string;
  flags: string;
  what(x: number, nm: Namer): string;
  run(m: Machine, x: number): string;
}

const FOLLOW_A = 'Z and N follow the new A';

export const OPS: Record<number, OpSpec> = {
  [Op.NOP]: {
    name: 'NOP',
    syntax: 'NOP',
    does: 'nothing',
    flags: 'unchanged',
    what: () => 'Do nothing.',
    run: () => 'Nothing happens.',
  },
  [Op.LOAD_A]: {
    name: 'LOAD A',
    syntax: 'LOAD A, [addr]',
    does: 'A ← RAM[addr]',
    flags: FOLLOW_A,
    what: (x, nm) => `Copy the number in RAM address ${hex(x)}${nm(x)} into register A.`,
    run: (m, x) => {
      const v = m.read(x);
      m.setA(v);
      return `A ← ${v}`;
    },
  },
  [Op.STORE]: {
    name: 'STORE',
    syntax: 'STORE [addr], A',
    does: 'RAM[addr] ← A',
    flags: 'unchanged',
    what: (x, nm) => `Copy register A into RAM address ${hex(x)}${nm(x)}.`,
    run: (m, x) => {
      m.write(x, m.a);
      return `RAM ${hex(x)}${m.nm(x)} ← ${m.a}`;
    },
  },
  [Op.LDI_A]: {
    name: 'LDI A',
    syntax: 'LDI A, n',
    does: 'A ← n',
    flags: FOLLOW_A,
    what: x => `Put the number ${x} straight into register A.`,
    run: (m, x) => {
      m.setA(x);
      return `A ← ${x}`;
    },
  },
  [Op.LOAD_B]: {
    name: 'LOAD B',
    syntax: 'LOAD B, [addr]',
    does: 'B ← RAM[addr]',
    flags: 'unchanged',
    what: (x, nm) => `Copy the number in RAM address ${hex(x)}${nm(x)} into register B.`,
    run: (m, x) => {
      m.b = m.read(x);
      return `B ← ${m.b}`;
    },
  },
  [Op.LDI_B]: {
    name: 'LDI B',
    syntax: 'LDI B, n',
    does: 'B ← n',
    flags: 'unchanged',
    what: x => `Put the number ${x} straight into register B.`,
    run: (m, x) => {
      m.b = x;
      return `B ← ${x}`;
    },
  },
  [Op.ADD]: {
    name: 'ADD',
    syntax: 'ADD A, B',
    does: 'A ← A + B (255 + 1 wraps to 0)',
    flags: FOLLOW_A,
    what: () => 'Add B to A. (Numbers wrap around after 255.)',
    run: m => {
      const r = (m.a + m.b) & 255;
      const s = `A ← ${m.a} + ${m.b} = ${r}`;
      m.setA(r);
      return s;
    },
  },
  [Op.SUB]: {
    name: 'SUB',
    syntax: 'SUB A, B',
    does: 'A ← A − B (0 − 1 wraps to 255)',
    flags: FOLLOW_A,
    what: () => 'Subtract B from A. (Below 0 wraps around to 255, 254, ...)',
    run: m => {
      const r = (m.a - m.b) & 255;
      const s = `A ← ${m.a} − ${m.b} = ${r}`;
      m.setA(r);
      return s;
    },
  },
  [Op.JMP]: {
    name: 'JMP',
    syntax: 'JMP label',
    does: 'PC ← address of label',
    flags: 'unchanged',
    what: x => `Jump: set PC to ${hex(x)}, so the next instruction comes from there.`,
    run: (m, x) => {
      m.pc = x;
      return `PC ← ${hex(x)}`;
    },
  },
  [Op.JZ]: {
    name: 'JZ',
    syntax: 'JZ label',
    does: 'if Z = 1: PC ← address of label',
    flags: 'unchanged',
    what: x => `If the Z flag is 1 (A is zero), jump to ${hex(x)}. Otherwise carry on.`,
    run: (m, x) => {
      if (!m.z) return 'Z is 0, so no jump.';
      m.pc = x;
      return `Z is 1, so jump: PC ← ${hex(x)}`;
    },
  },
  [Op.JN]: {
    name: 'JN',
    syntax: 'JN label',
    does: 'if N = 1: PC ← address of label',
    flags: 'unchanged',
    what: x => `If the N flag is 1 (A is 128 or more, "negative"), jump to ${hex(x)}. Otherwise carry on.`,
    run: (m, x) => {
      if (!m.n) return 'N is 0, so no jump.';
      m.pc = x;
      return `N is 1, so jump: PC ← ${hex(x)}`;
    },
  },
  [Op.LDX_A]: {
    name: 'LDX A',
    syntax: 'LDX A, [n]',
    does: 'A ← RAM[n + A]',
    flags: FOLLOW_A,
    what: x => `Add A to ${x} to make an address, and copy the number stored there into A.`,
    run: (m, x) => {
      const addr = (x + m.a) & 255;
      const s = `A ← RAM[${x} + ${m.a}] = RAM[${hex(addr)}] = ${m.mem[addr]}`;
      m.setA(m.read(addr));
      return s;
    },
  },
  [Op.RTI]: {
    name: 'RTI',
    syntax: 'RTI',
    does: 'PC, A, B and flags ← the slot at RAM[CUR]; back to user mode',
    flags: 'restored from the slot',
    what: () =>
      'Return from interrupt: reload PC, A, B and the flags from the slot at address CUR, so that process carries on.',
    run: m => m.returnFromInterrupt(),
  },
};

export const opSpec = (op: number): OpSpec => OPS[op] ?? OPS[Op.NOP];
