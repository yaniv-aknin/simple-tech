import {describe, expect, it} from 'vitest';
import {concurrencySetup, procBase} from './concurrency/concurrency.ts';
import {Keyboard} from '../machine/keyboard.ts';
import {parseC} from './c-source.ts';
import {boot} from './demo.ts';
import {ADDR, pongSetup} from './pong/pong.ts';

const clock = () => 0;

describe('pong', () => {
  it('stays on screen, and holding right returns the first puck', () => {
    const {machine: m, program} = boot(pongSetup(), clock);
    new Keyboard(m, ADDR.KEY).press(1);
    let best = 0;
    for (let i = 0; i < 5000; i++) {
      m.stepInstruction();
      if (m.pc !== program.labels.loop) continue;
      expect(m.mem[ADDR.BX]).toBeLessThan(16);
      expect(m.mem[ADDR.BY]).toBeLessThan(12);
      expect(m.mem[ADDR.PX]).toBeLessThanOrEqual(13);
      best = Math.max(best, m.mem[ADDR.SCORE]);
    }
    expect(best).toBeGreaterThan(0);
  });
});

describe('concurrency', () => {
  it.each([1, 2, 4, 8])('shares the CPU between %i processes', n => {
    const {machine: m} = boot(concurrencySetup(n), clock);
    for (let i = 0; i < 2000; i++) m.stepInstruction();
    const counts = Array.from({length: n}, (_, i) => m.mem[procBase(i) + 1] * 256 + m.mem[procBase(i)]);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3);
  });

  it('carries into the high byte', () => {
    const {machine: m} = boot(concurrencySetup(1), clock);
    m.mem[procBase(0)] = 0xff;
    for (let i = 0; i < 20; i++) m.stepInstruction();
    expect(m.mem[procBase(0) + 1]).toBe(1);
  });
});

describe('C sources', () => {
  it.each([
    ['pong', pongSetup()],
    ['concurrency', concurrencySetup(3)],
  ])('%s: every C tag maps to assembly and back', (_, setup) => {
    const {program} = boot(setup, clock);
    const cTags = parseC(setup.cSource).flatMap(l => (l.tag ? [l.tag] : []));
    expect(new Set(cTags).size).toBe(cTags.length);
    expect(new Set(cTags)).toEqual(new Set(program.tagCount.keys()));
  });
});
