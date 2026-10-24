import {assemble, type Program} from '../machine/assembler.ts';
import type {RateChart} from '../ui/chart.ts';
import type {Keyboard} from '../machine/keyboard.ts';
import {Machine, type Interrupt} from '../machine/machine.ts';

/** How a core after the first one starts: where it begins, and whether it is on a timer. */
export interface CoreSetup {
  interrupt?: Interrupt;
  start: number;
  kernel: boolean;
}

export interface DemoSetup {
  source: string;
  cSource: string;
  symbols: Record<string, number>;
  names: Record<number, string>;
  /** The first core's timer. */
  interrupt?: Interrupt;
  /** RAM below this address belongs to the kernel: its code, and the tables it keeps. */
  kernelEnd?: number;
  /** The cores after the first, which share its RAM. */
  moreCores?: CoreSetup[];
  cellColor(addr: number): string;
  init?(cores: Machine[], program: Program): void;
}

/** Runs a core's kernel to its end in one go, as when the kernel is hidden: it takes no visible time. */
export function finishKernel(core: Machine) {
  for (let i = 0; core.kernel && i < 100; i++) core.stepInstruction();
}

/**
 * One tick of every core: an instruction, or just a phase of one (fetch or execute) when those are being watched.
 * With the kernel hidden, a core that enters the kernel runs it to its end, so a tick never ends inside it.
 */
export function tick(cores: Machine[], byPhase: boolean, kernelVisible: boolean) {
  for (const core of cores) {
    if (byPhase) core.stepPhase();
    else core.stepInstruction();
    if (!kernelVisible) finishKernel(core);
  }
}

/** True when a core is about to run an instruction that has a breakpoint on it. */
export const atBreakpoint = (cores: Machine[], breakpoints: Set<number>) =>
  cores.some(core => core.next === 'fetch' && breakpoints.has(core.pc));

export interface Session {
  setup: DemoSetup;
  program: Program;
  /** The first core. */
  machine: Machine;
  /** Every core, the first included. */
  cores: Machine[];
}

export function boot(setup: DemoSetup, clock?: () => number): Session {
  const program = assemble(setup.source, setup.symbols);
  const machine = new Machine(program.bytes, {names: setup.names, interrupt: setup.interrupt, clock});
  const shared = {mem: machine.mem, access: machine.access};
  const more = (setup.moreCores ?? []).map(core => {
    const m = new Machine(program.bytes, {names: setup.names, interrupt: core.interrupt, clock, shared});
    m.pc = core.start;
    m.kernel = core.kernel;
    return m;
  });
  const cores = [machine, ...more];
  setup.init?.(cores, program);
  return {setup, program, machine, cores};
}

export interface DemoView {
  readonly keyboard?: Keyboard;
  render(t: number): void;
}

export interface Demo {
  start(options: {processes: number; cores: number; chart: RateChart}): {session: Session; view: DemoView};
}
