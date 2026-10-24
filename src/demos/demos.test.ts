import {describe, expect, it} from 'vitest';
import {SLOT_SIZE, TABLE, concurrencySetup, coreOf, curAddr, procBase} from './concurrency/concurrency.ts';
import {Keyboard} from '../machine/keyboard.ts';
import {parseC} from './c-source.ts';
import {atBreakpoint, boot, finishKernel, tick} from './demo.ts';
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

describe('pong waiting for a key', () => {
  const stepsWithoutReachingLoop = (m: ReturnType<typeof boot>['machine'], loop: number) => {
    for (let i = 0; i < 500; i++) {
      m.stepInstruction();
      if (m.pc === loop) return false;
    }
    return true;
  };

  it('does not start until a key is pressed', () => {
    const {machine: m, program} = boot(pongSetup(), clock);
    expect(stepsWithoutReachingLoop(m, program.labels.loop)).toBe(true);
    expect(m.mem[ADDR.BX]).toBe(5);
    new Keyboard(m, ADDR.KEY).press(1);
    expect(stepsWithoutReachingLoop(m, program.labels.loop)).toBe(false);
  });

  it('waits again after a miss', () => {
    const {machine: m, program} = boot(pongSetup(), clock);
    const keyboard = new Keyboard(m, ADDR.KEY);
    keyboard.press(-1);
    for (let i = 0; i < 5000 && m.pc !== program.labels.miss; i++) m.stepInstruction();
    expect(m.pc).toBe(program.labels.miss);
    keyboard.release(-1);
    expect(stepsWithoutReachingLoop(m, program.labels.loop)).toBe(true);
  });
});

describe('concurrency', () => {
  it.each([1, 2, 4, 8])('shares the CPU between %i processes', n => {
    const {machine: m} = boot(concurrencySetup(n), clock);
    for (let i = 0; i < 40 * n; i++) m.stepInstruction();
    const counts = Array.from({length: n}, (_, i) => m.mem[procBase(i)]);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3);
  });

  it('wraps from 255 round to 0', () => {
    const {machine: m} = boot(concurrencySetup(1), clock);
    m.mem[procBase(0)] = 0xfe;
    for (let i = 0; i < 40; i++) m.stepInstruction();
    expect(m.mem[procBase(0)]).toBeGreaterThan(0);
    expect(m.mem[procBase(0)]).toBeLessThan(0x20);
  });
});

describe('concurrency on several cores', () => {
  const run = (n: number, cores: number, steps: number) => {
    const session = boot(concurrencySetup(n, cores), clock);
    const seen = session.cores.map(() => new Set<number>());
    for (let i = 0; i < steps; i++) {
      session.cores.forEach((core, k) => {
        core.stepInstruction();
        if (!core.kernel && k < n) seen[k].add((core.mem[curAddr(k)] - TABLE) / SLOT_SIZE);
      });
    }
    return {...session, seen};
  };

  it.each([
    [4, 2],
    [8, 2],
    [8, 4],
    [4, 4],
  ])('runs %i processes on %i cores, each process only on its own core', (n, cores) => {
    const {machine: m, seen} = run(n, cores, 300);
    for (let i = 0; i < n; i++) expect(m.mem[procBase(i)]).toBeGreaterThan(0);
    seen.forEach((processes, k) => {
      expect([...processes].sort()).toEqual(
        Array.from({length: n}, (_, i) => i).filter(i => coreOf(i, cores) === k),
      );
    });
  });

  it('gives every core its own registers and program counter, over the same RAM', () => {
    const {cores} = run(4, 2, 17);
    expect(cores).toHaveLength(2);
    expect(cores[0].mem).toBe(cores[1].mem);
    expect(cores[0].access).toBe(cores[1].access);
    expect(cores[0].instrCount).toBeGreaterThan(0);
    expect(cores[1].instrCount).toBeGreaterThan(0);
    expect(cores[0].pc).not.toBe(cores[1].pc);
  });

  it('leaves a core idle when there is no process for it', () => {
    const {machine: m, cores} = run(2, 4, 200);
    expect(m.mem[procBase(0)]).toBeGreaterThan(0);
    expect(m.mem[procBase(1)]).toBeGreaterThan(0);
    for (const idle of cores.slice(2)) {
      expect(idle.kernel).toBe(false);
      expect(idle.interrupt).toBeUndefined();
      expect(idle.pc).toBe(idle === cores[2] ? 16 : 24);
    }
  });

  it('shares the time of one core between its own processes only', () => {
    const {machine: m} = run(4, 2, 400);
    const counts = [0, 2].map(i => m.mem[procBase(i)]);
    expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(3);
  });
});

describe('hiding the kernel', () => {
  const total = (hidden: boolean, instructions: number) => {
    const {machine: m, cores} = boot(concurrencySetup(2), clock);
    if (hidden) cores.forEach(finishKernel);
    let kernelSeen = 0;
    for (let i = 0; i < instructions; i++) {
      m.stepInstruction();
      if (hidden) finishKernel(m);
      if (m.kernel) kernelSeen++;
    }
    return {counts: [0, 1].map(i => m.mem[procBase(i)]), kernelSeen};
  };

  it('runs the kernel to its end at once, so it is never seen running', () => {
    expect(total(true, 200).kernelSeen).toBe(0);
    expect(total(false, 200).kernelSeen).toBeGreaterThan(0);
  });

  it('spends no time on the kernel, so the counters get further', () => {
    const hidden = total(true, 200).counts;
    const shown = total(false, 200).counts;
    expect(hidden[0] + hidden[1]).toBeGreaterThan(shown[0] + shown[1]);
  });

  it('still shares the time between the processes', () => {
    const {counts} = total(true, 200);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(3);
  });

  it('marks the kernel as the RAM below the processes', () => {
    expect(concurrencySetup(2).kernelEnd).toBe(procBase(0));
    expect(pongSetup().kernelEnd).toBeUndefined();
  });
});

describe('breakpoints', () => {
  it('stop when a core is about to run the address, and not before', () => {
    const {machine: m, program} = boot(pongSetup(), clock);
    new Keyboard(m, ADDR.KEY).press(1);
    const at = program.labels.loop;
    const breakpoints = new Set([at]);
    expect(atBreakpoint([m], new Set())).toBe(false);
    let stopped = false;
    for (let i = 0; i < 5000 && !stopped; i++) {
      m.stepInstruction();
      stopped = atBreakpoint([m], breakpoints);
      if (!stopped) expect(m.pc).not.toBe(at);
    }
    expect(stopped).toBe(true);
    expect(m.pc).toBe(at);
    expect(m.next).toBe('fetch');
  });

  it('look at every core', () => {
    const {cores} = boot(concurrencySetup(4, 2), clock);
    cores[1].pc = 0x62;
    cores[1].next = 'fetch';
    expect(atBreakpoint(cores, new Set([0x62]))).toBe(true);
  });
});

describe('a tick', () => {
  it('is an instruction, or one phase of it when the phases are shown', () => {
    const {cores} = boot(pongSetup(), clock);
    const m = cores[0];
    tick(cores, true, true);
    expect(m.lastPhase).toBe('fetch');
    expect(m.instrCount).toBe(0);
    tick(cores, true, true);
    expect(m.lastPhase).toBe('execute');
    expect(m.instrCount).toBe(1);
    tick(cores, false, true);
    expect(m.instrCount).toBe(2);
    expect(m.next).toBe('fetch');
  });

  it('includes the kernel only while the kernel is shown', () => {
    const hidden = boot(concurrencySetup(2), clock);
    finishKernel(hidden.machine);
    const shown = boot(concurrencySetup(2), clock);
    let kernelTicks = 0;
    let hiddenKernelTicks = 0;
    for (let i = 0; i < 200; i++) {
      tick(shown.cores, false, true);
      if (shown.machine.kernel) kernelTicks++;
      tick(hidden.cores, false, false);
      if (hidden.machine.kernel) hiddenKernelTicks++;
    }
    expect(kernelTicks).toBeGreaterThan(0);
    expect(hiddenKernelTicks).toBe(0);
  });

  it('moves every core on', () => {
    const {cores} = boot(concurrencySetup(4, 2), clock);
    tick(cores, false, true);
    expect(cores.map(c => c.instrCount)).toEqual([1, 1]);
  });
});

describe('C sources', () => {
  it.each([
    ['pong', pongSetup()],
    ['concurrency', concurrencySetup(3)],
    ['concurrency on two cores', concurrencySetup(3, 2)],
  ])('%s: every C tag maps to assembly and back', (_, setup) => {
    const {program} = boot(setup, clock);
    const cTags = parseC(setup.cSource).flatMap(l => (l.tag ? [l.tag] : []));
    expect(new Set(cTags).size).toBe(cTags.length);
    expect(new Set(cTags)).toEqual(new Set(program.tagCount.keys()));
  });
});
