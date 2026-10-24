import {describe, expect, it} from 'vitest';
import {assemble} from './assembler.ts';
import {Keyboard} from './keyboard.ts';
import {Machine, type MachineOptions} from './machine.ts';

const clock = () => 0;
const load = (src: string, symbols = {}, options: MachineOptions = {}) =>
  new Machine(assemble(src, symbols).bytes, {clock, ...options});

describe('Machine', () => {
  it('splits an instruction into fetch and execute phases', () => {
    const m = load('LDI A, 7');
    m.stepPhase();
    expect(m).toMatchObject({lastPhase: 'fetch', next: 'execute', pc: 2, ir: [3, 7], a: 0});
    m.stepPhase();
    expect(m).toMatchObject({lastPhase: 'execute', next: 'fetch', a: 7, instrCount: 1});
  });

  it('wraps arithmetic and sets flags from A', () => {
    const m = load('LDI A, 0\nLDI B, 1\nSUB A, B\nADD A, B');
    for (let i = 0; i < 3; i++) m.stepInstruction();
    expect(m).toMatchObject({a: 255, z: 0, n: 1});
    m.stepInstruction();
    expect(m).toMatchObject({a: 0, z: 1, n: 0});
  });

  it('jumps conditionally', () => {
    const m = load('LDI A, 0\nJZ yes\nyes:\nLDI A, 1\nJZ yes');
    m.stepInstruction();
    m.stepInstruction();
    expect(m.pc).toBe(4);
    m.stepInstruction();
    m.stepInstruction();
    expect(m.pc).toBe(8);
  });

  it('loads indexed by A', () => {
    const m = load('LDI A, 2\nLDX A, [32]');
    m.mem[0x22] = 99;
    m.stepInstruction();
    m.stepInstruction();
    expect(m.a).toBe(99);
  });

  it('records reads and writes for the UI', () => {
    const m = load('LOAD A, [X]\nSTORE [Y], A', {X: 0x80, Y: 0x81});
    m.stepInstruction();
    m.stepInstruction();
    expect(m.access[0x80]?.kind).toBe('read');
    expect(m.access[0x81]?.kind).toBe('write');
  });

  it('traps on the timer and RTI resumes the saved process', () => {
    const src = `
      .org 0
      RTI
      .org 0x40
      user:
      LDI A, 200
      LDI B, 3
      JMP user
    `;
    const m = load(src, {}, {interrupt: {quantum: 2, curAddr: 0x08}});
    m.mem[0x08] = 0x10;
    m.mem[0x10] = 0x40;
    m.kernel = true;

    m.stepInstruction();
    expect(m).toMatchObject({kernel: false, pc: 0x40});
    m.stepInstruction();
    m.stepInstruction();
    expect(m.timer).toBe(2);

    m.stepPhase();
    expect(m).toMatchObject({lastPhase: 'timer', kernel: true, pc: 0});
    expect([...m.mem.slice(0x10, 0x14)]).toEqual([0x44, 200, 3, 0b10]);

    m.a = m.b = 0;
    m.stepInstruction();
    expect(m).toMatchObject({kernel: false, timer: 0, pc: 0x44, a: 200, b: 3, n: 1, z: 0});
  });
});

describe('Keyboard', () => {
  const KEY = 0xf0;
  const setup = () => {
    const m = load('loop:\nLOAD A, [KEY]\nJMP loop', {KEY});
    return {m, kb: new Keyboard(m, KEY)};
  };

  it('reads the held direction until release', () => {
    const {m, kb} = setup();
    kb.press(-1);
    m.stepInstruction();
    expect(m.a).toBe(255);
    expect(m.mem[KEY]).toBe(255);
    kb.release(-1);
    expect(m.mem[KEY]).toBe(0);
  });

  it('latches a tap until the CPU reads it', () => {
    const {m, kb} = setup();
    kb.press(1);
    kb.release(1);
    expect(m.mem[KEY]).toBe(1);
    m.stepInstruction();
    expect(m.a).toBe(1);
    expect(m.mem[KEY]).toBe(0);
  });
});
