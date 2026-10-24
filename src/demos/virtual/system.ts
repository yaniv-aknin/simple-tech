import {assemble, type Program} from '../../machine/assembler.ts';
import {hex} from '../../machine/format.ts';
import {Fault, Machine, type Access} from '../../machine/machine.ts';

export const PAGE_SIZE = 4;
export const PAGES = 256 / PAGE_SIZE;
export const DEFAULT_FRAMES = 16;
/** A page table entry is this plus the frame number, or 0 when the page has no frame. */
export const PRESENT = 0x80;
/** A page table has one byte per page, so it fills this many frames. */
export const TABLE_FRAMES = PAGES / PAGE_SIZE;

/** A frame holds either a page of a process's memory or a part of a process's page table. */
export type FrameOwner =
  {pid: number; kind: 'page'; page: number} | {pid: number; kind: 'table'; part: number};

export interface SystemOptions {
  frames?: number;
  /** Keep the page tables in the shared RAM, taking frames from the programs, instead of out of sight. */
  tablesInRam?: boolean;
  clock?: () => number;
}

export interface Watch {
  label: string;
  /** Show the byte at this address of the process's memory... */
  addr?: number;
  /** ...or this register. */
  reg?: 'a';
  hex?: boolean;
}

/** A number the user can set on a stopped process; the program's source is built from it. */
export interface Param {
  key: string;
  label: string;
  initial: number;
}

export interface ProcessDef {
  name: string;
  blurb: string;
  source: string | ((values: Record<string, number>) => string);
  params?: Param[];
  symbols: Record<string, number>;
  /** Bytes the loader sets beside the program, such as a starting value. */
  data?: Record<number, number>;
  watch: Watch[];
}

/** `stopped` is the state before the program is loaded from disk, and again after a reset. */
export type ProcessState = 'stopped' | 'running' | 'paused' | 'crashed';

export interface Process {
  readonly def: ProcessDef;
  program: Program;
  readonly values: Record<string, number>;
  readonly names: Record<number, string>;
  /** The page table: the frame behind each page of the process's memory, or -1 when it has none. */
  readonly table: Int8Array;
  /** The frames holding its page table, when the tables are kept in RAM. */
  tableFrames: number[];
  readonly access: (Access | null)[];
  /** Its own CPU. */
  readonly cpu: Machine;
  state: ProcessState;
  lastPc: number | null;
  crash: string | null;
  /** Its memory as it was when it crashed (null where it had no frame): the frames themselves are given back. */
  frozen: (number | null)[] | null;
}

const assembleDef = (def: ProcessDef, values: Record<string, number>) =>
  assemble(typeof def.source === 'string' ? def.source : def.source(values), def.symbols);

const entryOf = (program: Program) => {
  for (const it of program.items) if (it.kind === 'ins') return it.addr;
  return 0;
};

/**
 * Several processes, each on its own CPU, sharing a small physical RAM. Each sees its own 256 bytes, starting at
 * 0x00; its page table decides which frames of the shared RAM those bytes really are. A process's pages get
 * frames when it is started (its program, as if loaded from disk) and the first time it uses any other page.
 */
export class VirtualSystem {
  readonly frames: number;
  readonly tablesInRam: boolean;
  readonly ram: Uint8Array;
  readonly ramAccess: (Access | null)[];
  readonly owner: (FrameOwner | null)[];
  readonly procs: Process[];
  private readonly clock: () => number;

  constructor(
    defs: ProcessDef[],
    {frames = DEFAULT_FRAMES, tablesInRam = false, clock = () => performance.now()}: SystemOptions = {},
  ) {
    this.frames = frames;
    this.tablesInRam = tablesInRam;
    this.clock = clock;
    this.ram = new Uint8Array(frames * PAGE_SIZE);
    this.ramAccess = new Array(this.ram.length).fill(null);
    this.owner = new Array(frames).fill(null);
    this.procs = defs.map((def, pid) => {
      const values = Object.fromEntries((def.params ?? []).map(p => [p.key, p.initial]));
      const program = assembleDef(def, values);
      const names: Record<number, string> = {};
      for (const [name, addr] of Object.entries(def.symbols)) names[addr] = name;
      const space = {
        read: (addr: number, fetch: boolean) => this.read(pid, addr, fetch),
        write: (addr: number, value: number) => this.write(pid, addr, value),
      };
      return {
        def,
        program,
        values,
        names,
        table: new Int8Array(PAGES).fill(-1),
        tableFrames: [],
        access: new Array(256).fill(null),
        cpu: new Machine(new Uint8Array(0), {clock, space}),
        state: 'stopped',
        lastPc: null,
        crash: null,
        frozen: null,
      };
    });
    this.procs.forEach((_, pid) => this.resetCpu(pid));
  }

  private resetCpu(pid: number) {
    const proc = this.procs[pid];
    Object.assign(proc.cpu, {
      pc: entryOf(proc.program),
      a: 0,
      b: 0,
      z: 0,
      n: 0,
      next: 'fetch',
      executing: null,
    });
  }

  /** Where in RAM a page's table entry is stored, or null when the tables are out of sight. */
  entryAddress(pid: number, page: number) {
    const frame = this.procs[pid].tableFrames[page >> 2];
    return frame === undefined ? null : frame * PAGE_SIZE + (page & 3);
  }

  private setEntry(pid: number, page: number, frame: number) {
    this.procs[pid].table[page] = frame;
    const at = this.entryAddress(pid, page);
    if (at === null) return;
    this.ram[at] = frame < 0 ? 0 : PRESENT | frame;
    this.ramAccess[at] = {kind: 'write', t: this.clock()};
  }

  private takeFrame(owner: FrameOwner, need: string) {
    const frame = this.owner.indexOf(null);
    if (frame < 0) throw new Fault(`it needed a frame for ${need}, but all ${this.frames} frames are in use`);
    this.owner[frame] = owner;
    this.ram.fill(0, frame * PAGE_SIZE, (frame + 1) * PAGE_SIZE);
    return frame;
  }

  private allocateTable(pid: number) {
    for (let part = 0; part < TABLE_FRAMES; part++) {
      this.procs[pid].tableFrames.push(this.takeFrame({pid, kind: 'table', part}, 'its page table'));
    }
  }

  private map(pid: number, page: number) {
    const frame = this.takeFrame({pid, kind: 'page', page}, hex(page * PAGE_SIZE));
    this.setEntry(pid, page, frame);
    return frame;
  }

  private free(pid: number) {
    const proc = this.procs[pid];
    proc.table.forEach((frame, page) => {
      if (frame >= 0) this.setEntry(pid, page, -1);
    });
    this.owner.forEach((o, f) => {
      if (o?.pid === pid) this.owner[f] = null;
    });
    proc.tableFrames = [];
  }

  /** The loader: gives the program's own pages frames and copies it in, as if reading it from disk. */
  private load(pid: number) {
    const {def, program} = this.procs[pid];
    const image = new Uint8Array(program.bytes);
    for (const [addr, v] of Object.entries(def.data ?? {})) image[Number(addr)] = v;
    const pages = new Set(
      [...program.codeAddrs, ...Object.keys(def.data ?? {}).map(Number)].map(a => a >> 2),
    );
    try {
      if (this.tablesInRam) this.allocateTable(pid);
      for (const page of [...pages].sort((a, b) => a - b)) {
        const frame = this.map(pid, page);
        this.ram.set(image.subarray(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), frame * PAGE_SIZE);
      }
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      this.crash(pid, e.message);
    }
  }

  private translate(pid: number, addr: number, fetch: boolean) {
    const page = addr >> 2;
    const entry = this.entryAddress(pid, page);
    if (entry !== null) this.ramAccess[entry] = {kind: 'read', t: this.clock()};
    let frame = this.procs[pid].table[page];
    if (frame < 0) {
      if (fetch) {
        throw new Fault(`it tried to run an instruction at ${hex(addr)}, which is not mapped to any memory`);
      }
      frame = this.map(pid, page);
    }
    return frame * PAGE_SIZE + (addr & 3);
  }

  private touch(pid: number, addr: number, phys: number, kind: Access['kind']) {
    const access = {kind, t: this.clock()};
    this.procs[pid].access[addr] = access;
    this.ramAccess[phys] = access;
  }

  private read(pid: number, addr: number, fetch: boolean) {
    const phys = this.translate(pid, addr, fetch);
    this.touch(pid, addr, phys, 'read');
    return this.ram[phys];
  }

  private write(pid: number, addr: number, value: number) {
    const phys = this.translate(pid, addr, false);
    this.touch(pid, addr, phys, 'write');
    this.ram[phys] = value;
  }

  /** The byte at `addr` of a process's memory, or null where it has no frame. Changes nothing. */
  peek(pid: number, addr: number) {
    const frame = this.procs[pid].table[addr >> 2];
    return frame < 0 ? null : this.ram[frame * PAGE_SIZE + (addr & 3)];
  }

  /** Overwrites a byte of a process's memory, as if it had written it. False where the byte has no frame. */
  poke(pid: number, addr: number, value: number) {
    const proc = this.procs[pid];
    const frame = proc.table[addr >> 2];
    if (frame < 0 || proc.state === 'crashed') return false;
    const phys = frame * PAGE_SIZE + (addr & 3);
    this.ram[phys] = value & 255;
    this.touch(pid, addr, phys, 'write');
    return true;
  }

  /**
   * Overwrites a byte of physical RAM that is in use. A byte of a page table changes the mapping it holds: the
   * page then leads wherever the new entry says, even to a frame that belongs to something else.
   */
  pokeFrame(index: number, value: number) {
    const own = this.owner[index >> 2];
    if (!own) return false;
    this.ram[index] = value & 255;
    this.ramAccess[index] = {kind: 'write', t: this.clock()};
    if (own.kind === 'table') {
      const frame = value & PRESENT ? value & 0x7f : -1;
      this.procs[own.pid].table[own.part * PAGE_SIZE + (index & 3)] = frame < this.frames ? frame : -1;
    }
    return true;
  }

  get framesInUse() {
    return this.owner.filter(o => o).length;
  }

  /** Starts a stopped process (loading it first) or resumes a paused one; pauses a running one. */
  toggle(pid: number) {
    const proc = this.procs[pid];
    if (proc.state === 'running') proc.state = 'paused';
    else if (proc.state === 'paused') proc.state = 'running';
    else if (proc.state === 'stopped') {
      this.load(pid);
      if (proc.state === 'stopped') proc.state = 'running';
    }
  }

  /** Changes a number the program is built from. Only a stopped process can be changed. */
  setParam(pid: number, key: string, value: number) {
    const proc = this.procs[pid];
    if (proc.state !== 'stopped' || !(key in proc.values)) return;
    proc.values[key] = Math.max(0, Math.min(255, Math.round(value)));
    proc.program = assembleDef(proc.def, proc.values);
    this.resetCpu(pid);
  }

  /** Stops a process and takes its memory back; starting it again loads it afresh. */
  reset(pid: number) {
    const proc = this.procs[pid];
    this.free(pid);
    this.resetCpu(pid);
    Object.assign(proc, {state: 'stopped', lastPc: null, crash: null, frozen: null});
    proc.access.fill(null);
  }

  /** One instruction on every running process's CPU. */
  step() {
    this.procs.forEach((proc, pid) => {
      if (proc.state !== 'running') return;
      try {
        proc.cpu.stepInstruction();
        proc.lastPc = proc.cpu.executing;
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
        this.crash(pid, e.message);
      }
    });
  }

  /** A crashed process gives its frames back; what its memory held is kept, to look at, until it is reset. */
  private crash(pid: number, why: string) {
    const proc = this.procs[pid];
    proc.frozen = Array.from({length: 256}, (_, addr) => this.peek(pid, addr));
    proc.state = 'crashed';
    proc.crash = why;
    this.free(pid);
  }
}
