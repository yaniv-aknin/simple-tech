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
  INC_A: 13,
  STX_B: 14,
} as const;

export interface OpSpec {
  name: string;
  syntax: string;
  does: string;
  flags: string;
  run(m: Machine, x: number): void;
}

const FOLLOW_A = 'Z and N follow the new A';

export const OPS: Record<number, OpSpec> = {
  [Op.NOP]: {
    name: 'NOP',
    syntax: 'NOP',
    does: 'nothing',
    flags: 'unchanged',
    run: () => {},
  },
  [Op.LOAD_A]: {
    name: 'LOAD A',
    syntax: 'LOAD A, [addr]',
    does: 'A ← RAM[addr]',
    flags: FOLLOW_A,
    run: (m, x) => m.setA(m.read(x)),
  },
  [Op.STORE]: {
    name: 'STORE',
    syntax: 'STORE [addr], A',
    does: 'RAM[addr] ← A',
    flags: 'unchanged',
    run: (m, x) => m.write(x, m.a),
  },
  [Op.LDI_A]: {
    name: 'LDI A',
    syntax: 'LDI A, n',
    does: 'A ← n',
    flags: FOLLOW_A,
    run: (m, x) => m.setA(x),
  },
  [Op.LOAD_B]: {
    name: 'LOAD B',
    syntax: 'LOAD B, [addr]',
    does: 'B ← RAM[addr]',
    flags: 'unchanged',
    run: (m, x) => {
      m.b = m.read(x);
    },
  },
  [Op.LDI_B]: {
    name: 'LDI B',
    syntax: 'LDI B, n',
    does: 'B ← n',
    flags: 'unchanged',
    run: (m, x) => {
      m.b = x;
    },
  },
  [Op.ADD]: {
    name: 'ADD',
    syntax: 'ADD A, B',
    does: 'A ← A + B (255 + 1 wraps to 0)',
    flags: FOLLOW_A,
    run: m => m.setA((m.a + m.b) & 255),
  },
  [Op.SUB]: {
    name: 'SUB',
    syntax: 'SUB A, B',
    does: 'A ← A − B (0 − 1 wraps to 255)',
    flags: FOLLOW_A,
    run: m => m.setA((m.a - m.b) & 255),
  },
  [Op.JMP]: {
    name: 'JMP',
    syntax: 'JMP label',
    does: 'PC ← address of label',
    flags: 'unchanged',
    run: (m, x) => {
      m.pc = x;
    },
  },
  [Op.JZ]: {
    name: 'JZ',
    syntax: 'JZ label',
    does: 'if Z = 1: PC ← address of label',
    flags: 'unchanged',
    run: (m, x) => {
      if (m.z) m.pc = x;
    },
  },
  [Op.JN]: {
    name: 'JN',
    syntax: 'JN label',
    does: 'if N = 1: PC ← address of label',
    flags: 'unchanged',
    run: (m, x) => {
      if (m.n) m.pc = x;
    },
  },
  [Op.LDX_A]: {
    name: 'LDX A',
    syntax: 'LDX A, [n]',
    does: 'A ← RAM[n + A]',
    flags: FOLLOW_A,
    run: (m, x) => m.setA(m.read((x + m.a) & 255)),
  },
  [Op.INC_A]: {
    name: 'INC A',
    syntax: 'INC A',
    does: 'A ← A + 1 (255 + 1 wraps to 0)',
    flags: FOLLOW_A,
    run: m => m.setA((m.a + 1) & 255),
  },
  [Op.STX_B]: {
    name: 'STX',
    syntax: 'STX [n], B',
    does: 'RAM[n + A] ← B',
    flags: 'unchanged',
    run: (m, x) => m.write((x + m.a) & 255, m.b),
  },
  [Op.RTI]: {
    name: 'RTI',
    syntax: 'RTI',
    does: 'PC, A, B and flags ← the slot at RAM[CUR]; back to user mode',
    flags: 'restored from the slot',
    run: m => m.returnFromInterrupt(),
  },
};

export const opSpec = (op: number): OpSpec => OPS[op] ?? OPS[Op.NOP];
