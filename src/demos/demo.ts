import {assemble, type Program} from '../machine/assembler.ts';
import type {Keyboard} from '../machine/keyboard.ts';
import {Machine, type Interrupt} from '../machine/machine.ts';

export type ViewMode = 'vars' | 'instr' | 'ram';

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
  defaultMode: ViewMode;
  start(options: {processes: number; cores: number}): {session: Session; view: DemoView};
}
