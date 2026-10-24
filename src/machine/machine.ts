import {hex, hex2} from './format.ts';
import {OPS, opSpec} from './isa.ts';

export type Phase = 'fetch' | 'execute' | 'timer';

export interface Access {
  kind: 'read' | 'write';
  t: number;
}

/** A program did something the machine cannot carry on from. */
export class Fault extends Error {}

/** Where a program's addresses actually lead, when they are not simply the machine's own RAM. */
export interface AddressSpace {
  read(addr: number, fetch: boolean): number;
  write(addr: number, value: number): void;
}

export interface Interrupt {
  /** User-mode instructions between timer interrupts. */
  quantum: number;
  /** Address holding the running process's slot address. A slot is PC, A, B, FLAGS. */
  curAddr: number;
}

export interface MachineOptions {
  names?: Record<number, string>;
  interrupt?: Interrupt;
  clock?: () => number;
  space?: AddressSpace;
}

export class Machine {
  readonly mem = new Uint8Array(256);
  readonly access: (Access | null)[] = new Array(256).fill(null);
  readonly names: Record<number, string>;
  readonly interrupt: Interrupt | undefined;
  private readonly space: AddressSpace | undefined;
  private readonly clock: () => number;

  pc = 0;
  a = 0;
  b = 0;
  z = 0;
  n = 0;
  ir: [number, number] = [0, 0];
  next: 'fetch' | 'execute' = 'fetch';
  lastPhase: Phase | null = null;
  executing: number | null = null;
  msg = 'Pick a speed to start. Each instruction takes two phases: fetch, then execute.';
  instrCount = 0;
  kernel = false;
  timer = 0;
  onRead: ((addr: number, value: number) => void) | null = null;

  constructor(
    bytes: Uint8Array,
    {names = {}, interrupt, clock = () => performance.now(), space}: MachineOptions = {},
  ) {
    this.mem.set(bytes);
    this.names = names;
    this.interrupt = interrupt;
    this.space = space;
    this.clock = clock;
  }

  nm = (addr: number) => (this.names[addr] ? ` (${this.names[addr]})` : '');

  touch(addr: number, kind: Access['kind']) {
    this.access[addr] = {kind, t: this.clock()};
  }

  read(addr: number) {
    if (this.space) return this.space.read(addr, false);
    this.touch(addr, 'read');
    const v = this.mem[addr];
    this.onRead?.(addr, v);
    return v;
  }

  write(addr: number, v: number) {
    if (this.space) {
      this.space.write(addr, v & 255);
      return;
    }
    this.mem[addr] = v & 255;
    this.touch(addr, 'write');
  }

  private fetchByte(addr: number) {
    return this.space ? this.space.read(addr, true) : this.mem[addr];
  }

  setA(v: number) {
    this.a = v & 255;
    this.z = this.a === 0 ? 1 : 0;
    this.n = this.a >= 128 ? 1 : 0;
  }

  private get interruptDue() {
    const q = this.interrupt?.quantum ?? 0;
    return q > 0 && !this.kernel && this.timer >= q;
  }

  stepPhase() {
    if (this.next === 'fetch' && this.interruptDue) this.trap();
    else if (this.next === 'fetch') this.fetch();
    else this.execute();
  }

  stepInstruction() {
    if (this.interruptDue) this.stepPhase();
    do this.stepPhase();
    while (this.next !== 'fetch');
  }

  private fetch() {
    const from = this.pc;
    this.executing = from;
    this.ir = [this.fetchByte(from), this.fetchByte((from + 1) & 255)];
    if (!this.space) {
      this.touch(from, 'read');
      this.touch((from + 1) & 255, 'read');
    }
    this.pc = (from + 2) & 255;
    const op = opSpec(this.ir[0]);
    this.msg =
      `FETCH: PC said ${hex(from)}, so the CPU copied the two bytes stored there ` +
      `(${hex2(this.ir[0])} ${hex2(this.ir[1])}) into IR. ` +
      `That means ${op.name}: ${op.what(this.ir[1], this.nm)} PC moved on to ${hex(this.pc)}.`;
    this.lastPhase = 'fetch';
    this.next = 'execute';
  }

  private execute() {
    const opcode = this.ir[0];
    if (!(opcode in OPS)) {
      throw new Fault(`it ran an illegal instruction (${hex2(opcode)}) at ${hex(this.executing ?? 0)}`);
    }
    const wasKernel = this.kernel;
    this.msg = `EXECUTE: ${opSpec(this.ir[0]).run(this, this.ir[1])}`;
    if (!wasKernel) this.timer++;
    this.instrCount++;
    this.lastPhase = 'execute';
    this.next = 'fetch';
  }

  private get slot() {
    if (!this.interrupt)
      throw new Fault('it ran RTI (return from interrupt), but there is no interrupt to return from');
    return this.mem[this.interrupt.curAddr];
  }

  private trap() {
    const slot = this.slot;
    this.write(slot, this.pc);
    this.write(slot + 1, this.a);
    this.write(slot + 2, this.b);
    this.write(slot + 3, this.z | (this.n << 1));
    this.msg =
      `TIMER: ${this.interrupt!.quantum} instructions are up. The CPU saved PC, A, B and the flags ` +
      `into the running process's slot (${hex(slot)}) and jumped to the kernel at 0x00.`;
    this.pc = 0;
    this.kernel = true;
    this.executing = null;
    this.lastPhase = 'timer';
  }

  returnFromInterrupt() {
    const s = this.slot;
    this.pc = this.read(s);
    this.setA(this.read(s + 1));
    this.b = this.read(s + 2);
    const flags = this.read(s + 3);
    this.z = flags & 1;
    this.n = (flags >> 1) & 1;
    this.kernel = false;
    this.timer = 0;
    return `From the slot at ${hex(s)}: PC ← ${hex(this.pc)}, A ← ${this.a}, B ← ${this.b}, and the flags too`;
  }
}
