import {Op} from './isa.ts';

export type Item =
  | {kind: 'note'; text: string}
  | {kind: 'label'; name: string}
  | {kind: 'ins'; addr: number; text: string; comment: string; bytes: [number, number]; tag: string | null};

export interface Program {
  items: Item[];
  bytes: Uint8Array;
  codeAddrs: Set<number>;
  labels: Record<string, number>;
  /** Source tag (from `.c tag`) of the instruction at each address. */
  tagAt: Map<number, string>;
  tagCount: Map<string, number>;
}

/**
 * Two-pass assembler. Every instruction is two bytes: opcode, operand.
 * `[NAME]` operands resolve through `symbols`; bare names resolve to labels.
 * `.c tag` marks the following instructions as compiled from the C line tagged `//@tag`.
 */
export function assemble(src: string, symbols: Record<string, number>): Program {
  const items: Item[] = [];
  const labels: Record<string, number> = {};
  let addr = 0;
  let tag: string | null = null;
  for (const raw of src.split('\n')) {
    const ci = raw.indexOf(';');
    const code = (ci < 0 ? raw : raw.slice(0, ci)).trim();
    const comment = ci < 0 ? '' : raw.slice(ci + 1).trim();
    if (!code) {
      if (comment) items.push({kind: 'note', text: comment});
      continue;
    }
    const org = code.match(/^\.org\s+(\S+)$/i);
    if (org) {
      addr = Number(org[1]);
      continue;
    }
    const cTag = code.match(/^\.c\s+(\w+)$/);
    if (cTag) {
      tag = cTag[1];
      continue;
    }
    const label = code.match(/^(\w+):$/);
    if (label) {
      labels[label[1]] = addr;
      items.push({kind: 'label', name: label[1]});
      continue;
    }
    items.push({kind: 'ins', addr, text: code, comment, bytes: [0, 0], tag});
    addr += 2;
  }

  const operand = (arg = '') => {
    const m = arg.match(/^\[(\w+)\]$/);
    if (m) return m[1] in symbols ? symbols[m[1]] : parseInt(m[1], 10);
    if (arg in labels) return labels[arg];
    if (/^\d+$/.test(arg)) return parseInt(arg, 10);
    throw new Error('bad operand: ' + arg);
  };

  const encode = (text: string): [number, number] => {
    const m = text.match(/^(\w+)\s*(.*)$/);
    if (!m) throw new Error('unknown instruction: ' + text);
    const args = m[2]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    switch (m[1].toUpperCase()) {
      case 'LOAD':
        return [args[0] === 'A' ? Op.LOAD_A : Op.LOAD_B, operand(args[1])];
      case 'STORE':
        return [Op.STORE, operand(args[0])];
      case 'LDI':
        return [args[0] === 'A' ? Op.LDI_A : Op.LDI_B, operand(args[1])];
      case 'ADD':
        return [Op.ADD, 0];
      case 'SUB':
        return [Op.SUB, 0];
      case 'JMP':
        return [Op.JMP, operand(args[0])];
      case 'JZ':
        return [Op.JZ, operand(args[0])];
      case 'JN':
        return [Op.JN, operand(args[0])];
      case 'LDX':
        return [Op.LDX_A, operand(args[1])];
      case 'INC':
        return [Op.INC_A, 0];
      case 'STX':
        return [Op.STX_B, operand(args[0])];
      case 'RTI':
        return [Op.RTI, 0];
      default:
        throw new Error('unknown instruction: ' + text);
    }
  };

  const bytes = new Uint8Array(256);
  const codeAddrs = new Set<number>();
  const tagAt = new Map<number, string>();
  const tagCount = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== 'ins') continue;
    it.bytes = encode(it.text);
    bytes.set(it.bytes, it.addr);
    codeAddrs.add(it.addr);
    codeAddrs.add(it.addr + 1);
    if (it.tag) {
      tagAt.set(it.addr, it.tag);
      tagCount.set(it.tag, (tagCount.get(it.tag) ?? 0) + 1);
    }
  }
  return {items, bytes, codeAddrs, labels, tagAt, tagCount};
}
