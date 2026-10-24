import {assemble, type Program} from '../machine/assembler';
import type {Keyboard} from '../machine/keyboard';
import {Machine, type Interrupt} from '../machine/machine';

export type ViewMode = 'vars' | 'instr' | 'ram';

export interface DemoSetup {
  source: string;
  symbols: Record<string, number>;
  names: Record<number, string>;
  interrupt?: Interrupt;
  cellColor(addr: number): string;
  init?(m: Machine, program: Program): void;
}

export interface Session {
  setup: DemoSetup;
  program: Program;
  machine: Machine;
}

export function boot(setup: DemoSetup, clock?: () => number): Session {
  const program = assemble(setup.source, setup.symbols);
  const machine = new Machine(program.bytes, {names: setup.names, interrupt: setup.interrupt, clock});
  setup.init?.(machine, program);
  return {setup, program, machine};
}

export interface DemoView {
  readonly keyboard?: Keyboard;
  render(t: number): void;
}

export interface Demo {
  defaultMode: ViewMode;
  start(options: {processes: number}): {session: Session; view: DemoView};
}
