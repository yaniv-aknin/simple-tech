import {describe, expect, it} from 'vitest';
import {assemble} from './assembler';
import {Op} from './isa';

describe('assemble', () => {
  it('encodes instructions as opcode/operand pairs', () => {
    const p = assemble('LDI A, 5\nSTORE [X], A\nADD A, B', {X: 0xf0});
    expect([...p.bytes.slice(0, 6)]).toEqual([Op.LDI_A, 5, Op.STORE, 0xf0, Op.ADD, 0]);
    expect([...p.codeAddrs]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('resolves labels, including forward references', () => {
    const p = assemble('start:\n  JMP end\nend:\n  JMP start', {});
    expect(p.labels).toEqual({start: 0, end: 2});
    expect([...p.bytes.slice(0, 4)]).toEqual([Op.JMP, 2, Op.JMP, 0]);
  });

  it('places code at .org', () => {
    const p = assemble('.org 0x40\nhere:\n  JMP here', {});
    expect(p.labels.here).toBe(0x40);
    expect(p.bytes[0x40]).toBe(Op.JMP);
    expect(p.bytes[0x41]).toBe(0x40);
  });

  it('keeps comments as listing items', () => {
    const p = assemble('; a note\nloop:\n  JMP loop ; again', {});
    expect(p.items).toEqual([
      {kind: 'note', text: 'a note'},
      {kind: 'label', name: 'loop'},
      {kind: 'ins', addr: 0, text: 'JMP loop', comment: 'again', bytes: [Op.JMP, 0], tag: null},
    ]);
  });

  it('tags instructions with the C line they came from', () => {
    const p = assemble('LDI A, 1\n.c one\nLDI A, 2\nlabel:\nADD A, B\n.c two\nRTI', {});
    expect([...p.tagAt]).toEqual([
      [2, 'one'],
      [4, 'one'],
      [6, 'two'],
    ]);
    expect([...p.tagCount]).toEqual([
      ['one', 2],
      ['two', 1],
    ]);
  });

  it('picks the register variant from the operands', () => {
    const p = assemble('LOAD B, [7]\nLDI B, 1', {});
    expect([...p.bytes.slice(0, 4)]).toEqual([Op.LOAD_B, 7, Op.LDI_B, 1]);
  });

  it('rejects unknown instructions and operands', () => {
    expect(() => assemble('FOO', {})).toThrow('unknown instruction: FOO');
    expect(() => assemble('JMP nowhere', {})).toThrow('bad operand: nowhere');
  });
});
