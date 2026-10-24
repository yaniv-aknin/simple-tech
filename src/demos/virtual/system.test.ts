import {describe, expect, it} from 'vitest';
import {PROCESSES} from './programs.ts';
import {VirtualSystem, type ProcessDef} from './system.ts';

const clock = () => 0;
const run = (sys: VirtualSystem, steps: number) => {
  for (let i = 0; i < steps; i++) sys.step();
};
const startAll = (sys: VirtualSystem) => sys.procs.forEach((_, pid) => sys.toggle(pid));
const snapshot = (sys: VirtualSystem, pid: number, to: number) =>
  Array.from({length: to}, (_, a) => sys.peek(pid, a));

describe('virtual memory', () => {
  it('starts with nothing in memory, and loads a program when it is started', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    expect(sys.framesInUse).toBe(0);
    expect(sys.procs.map(p => p.state)).toEqual(['stopped', 'stopped', 'stopped']);
    sys.toggle(0);
    expect(sys.procs[0].state).toBe('running');
    expect(sys.framesInUse).toBe(2);
    expect(sys.peek(0, 0x00)).not.toBeNull();
    expect(sys.peek(0, 0x40)).toBeNull();
  });

  it('gives each process its own frames for the same addresses', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    startAll(sys);
    expect(sys.procs[0].table[0]).not.toBe(sys.procs[1].table[0]);
  });

  it('fits the three programs into 64 bytes, with a frame to spare', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    startAll(sys);
    let peak = 0;
    for (let i = 0; i < 1000; i++) {
      sys.step();
      peak = Math.max(peak, sys.framesInUse);
    }
    expect(peak).toBe(15);
    expect(peak).toBeLessThan(sys.frames);
  });

  it('maps other pages the first time they are used', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    sys.toggle(0);
    expect(sys.peek(0, 0x80)).toBeNull();
    run(sys, 1);
    expect(sys.peek(0, 0x80)).toBe(0);
    expect(sys.framesInUse).toBe(3);
  });

  it('lets the scribbler wreck only its own memory, and crash on its own garbage', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    startAll(sys);
    const counter = snapshot(sys, 0, 0x08);
    const fib = snapshot(sys, 1, 0x10);
    run(sys, 1000);
    expect(snapshot(sys, 0, 0x08)).toEqual(counter);
    expect(snapshot(sys, 1, 0x10)).toEqual(fib);
    expect(sys.procs.map(p => p.state)).toEqual(['running', 'running', 'crashed']);
    expect(sys.procs[2].crash).toMatch(/illegal instruction \(FF\) at 0x14/);
    expect(sys.procs[2].frozen!.slice(0, 0x15)).toEqual(Array(0x15).fill(0xff));
  });

  it('keeps counting and adding while the scribbler runs', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    startAll(sys);
    run(sys, 200);
    const before = [sys.peek(0, 0x80), sys.peek(1, 0x80)];
    run(sys, 200);
    expect(sys.peek(0, 0x80)).not.toBe(before[0]);
    expect(sys.peek(1, 0x80)).not.toBe(before[1]);
  });

  it('computes Fibonacci numbers', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    sys.toggle(1);
    const seen: number[] = [];
    for (let i = 0; i < 70; i++) {
      sys.step();
      seen.push(sys.peek(1, 0x80)!, sys.peek(1, 0x81)!);
    }
    expect(seen).toEqual(expect.arrayContaining([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]));
  });

  it('pauses and resumes without losing memory', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    sys.toggle(0);
    run(sys, 40);
    sys.toggle(0);
    const count = sys.peek(0, 0x80);
    run(sys, 40);
    expect(sys.procs[0].state).toBe('paused');
    expect(sys.peek(0, 0x80)).toBe(count);
    sys.toggle(0);
    run(sys, 40);
    expect(sys.peek(0, 0x80)).toBeGreaterThan(count!);
  });

  it('resets one process: frees its frames, leaves the others, and reloads it afresh', () => {
    const sys = new VirtualSystem(PROCESSES, 16, clock);
    startAll(sys);
    run(sys, 1000);
    const fib = snapshot(sys, 1, 0x10);
    expect(sys.procs[2].state).toBe('crashed');
    sys.reset(2);
    expect(sys.procs[2].state).toBe('stopped');
    expect(sys.procs[2].table.every(f => f < 0)).toBe(true);
    expect(sys.framesInUse).toBe(8);
    expect(snapshot(sys, 1, 0x10)).toEqual(fib);
    sys.toggle(2);
    expect(sys.peek(2, 0x10)).toBe(3);
    run(sys, 5);
    expect(sys.procs[2].state).toBe('running');
  });

  it('crashes a process that runs code from an unmapped page, and the others carry on', () => {
    const stray: ProcessDef = {name: 'Stray', blurb: '', symbols: {}, watch: [], source: '.org 0\nJMP 128'};
    const sys = new VirtualSystem([stray, PROCESSES[0]], 16, clock);
    startAll(sys);
    run(sys, 40);
    expect(sys.procs[0].state).toBe('crashed');
    expect(sys.procs[0].crash).toMatch(/not mapped/);
    const count = sys.peek(1, 0x80)!;
    run(sys, 40);
    expect(sys.peek(1, 0x80)).toBeGreaterThan(count);
    sys.reset(0);
    expect(sys.framesInUse).toBe(3);
  });

  it('crashes a process when there is no free frame', () => {
    const hog: ProcessDef = {
      name: 'Hog',
      blurb: '',
      symbols: {},
      watch: [],
      source: '.org 0\nLDI A, 128\nLDI B, 4\nloop:\nSTX [0], B\nADD A, B\nJMP loop',
    };
    const sys = new VirtualSystem([hog], 16, clock);
    sys.toggle(0);
    run(sys, 100);
    expect(sys.procs[0].state).toBe('crashed');
    expect(sys.procs[0].crash).toMatch(/frames are in use/);
  });

  describe('the scribbler', () => {
    const scribble = (start: number, value: number, steps = 1000) => {
      const sys = new VirtualSystem(PROCESSES, 16, clock);
      sys.setParam(2, 'start', start);
      sys.setParam(2, 'value', value);
      startAll(sys);
      run(sys, steps);
      return sys;
    };

    it('shows the start and value in its program', () => {
      const sys = new VirtualSystem(PROCESSES, 16, clock);
      sys.setParam(2, 'start', 0x20);
      sys.setParam(2, 'value', 0xaa);
      expect(sys.procs[2].program.items.map(i => (i.kind === 'ins' ? i.text : '')).join()).toContain(
        'LDI A, 32,LDI B, 170',
      );
    });

    it('can only be changed while stopped', () => {
      const sys = new VirtualSystem(PROCESSES, 16, clock);
      sys.toggle(2);
      sys.setParam(2, 'value', 7);
      expect(sys.procs[2].values.value).toBe(0xff);
      sys.reset(2);
      sys.setParam(2, 'value', 7);
      expect(sys.procs[2].values.value).toBe(7);
    });

    it('dies of an illegal instruction when it overwrites its own code with 0xFF', () => {
      const sys = scribble(0x00, 0xff);
      expect(sys.procs[2].state).toBe('crashed');
      expect(sys.procs[2].crash).toMatch(/illegal instruction/);
    });

    it('dies of an empty memory when it starts above its code', () => {
      const sys = scribble(0x20, 0xff);
      expect(sys.procs[2].state).toBe('crashed');
      expect(sys.procs[2].crash).toMatch(/frames are in use/);
      expect(sys.framesInUse).toBe(8);
      expect(sys.procs.map(p => p.state)).toEqual(['running', 'running', 'crashed']);
    });

    it('survives writing 0 over its own code, by looping on', () => {
      const sys = scribble(0x00, 0x00);
      expect(sys.procs[2].state).toBe('running');
    });

    it('crashes, not throws, when it writes an RTI over itself', () => {
      const sys = scribble(0x00, 12);
      expect(sys.procs[2].state).toBe('crashed');
      expect(sys.procs[2].crash).toMatch(/RTI/);
    });
  });

  it('gives back the frames of a crashed process, but keeps what its memory held', () => {
    const sys = scribbleUntilCrash();
    const dead = sys.procs[2];
    expect(sys.framesInUse).toBe(8);
    expect(dead.table.every(f => f < 0)).toBe(true);
    expect(dead.frozen![0x00]).toBe(0xff);
    expect(dead.frozen![0x40]).toBeNull();
    sys.reset(2);
    expect(sys.procs[2].frozen).toBeNull();
  });

  describe('when the memory is full', () => {
    const hog = () => {
      const sys = new VirtualSystem(PROCESSES, 16, clock);
      sys.setParam(2, 'start', 0x20);
      sys.toggle(2);
      return sys;
    };

    it('crashes a program that is started with no frame to load it into', () => {
      const sys = hog();
      while (sys.framesInUse < sys.frames) sys.step();
      sys.toggle(2);
      sys.toggle(0);
      expect(sys.procs[0].state).toBe('crashed');
      expect(sys.procs[0].crash).toMatch(/frames are in use/);
      expect(sys.framesInUse).toBe(sys.frames);
    });

    it('crashes a program that gets only part of its code loaded, and frees what it got', () => {
      const sys = hog();
      while (sys.framesInUse < sys.frames - 1) sys.step();
      sys.toggle(2);
      sys.toggle(1);
      expect(sys.procs[1].state).toBe('crashed');
      expect(sys.procs[1].frozen![0x00]).not.toBeNull();
      expect(sys.procs[1].frozen![0x10]).toBeNull();
      expect(sys.framesInUse).toBe(sys.frames - 1);
    });

    it('lets a program that fits start beside the hog', () => {
      const sys = hog();
      while (sys.framesInUse < sys.frames - 3) sys.step();
      sys.toggle(2);
      sys.toggle(0);
      run(sys, 20);
      expect(sys.procs[0].state).toBe('running');
    });
  });
});

function scribbleUntilCrash() {
  const sys = new VirtualSystem(PROCESSES, 16, clock);
  startAll(sys);
  run(sys, 1000);
  return sys;
}

describe('with 128 bytes of physical memory', () => {
  it('has twice the frames, and the hog needs twice as many to run out', () => {
    const sys = new VirtualSystem(PROCESSES, 32, clock);
    expect(sys.frames).toBe(32);
    sys.setParam(2, 'start', 0x20);
    startAll(sys);
    let peak = 0;
    for (let i = 0; i < 3000 && sys.procs[2].state !== 'crashed'; i++) {
      sys.step();
      peak = Math.max(peak, sys.framesInUse);
    }
    expect(peak).toBe(32);
    expect(sys.procs[2].crash).toMatch(/all 32 frames are in use/);
    expect(sys.procs[0].state).toBe('running');
  });
});
