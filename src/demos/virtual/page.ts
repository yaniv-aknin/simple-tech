import './page.css';
import html from './page.html?raw';
import {hex, hex2} from '../../machine/format.ts';
import type {Program} from '../../machine/assembler.ts';
import type {Access} from '../../machine/machine.ts';
import {$, setText} from '../../ui/dom.ts';
import {editByte} from '../../ui/edit.ts';
import {flashLevel} from '../../ui/flash.ts';
import {attachTooltip} from '../../ui/tooltip.ts';
import type {Mount} from '../../page.ts';
import {procColor} from '../concurrency/concurrency.ts';
import {PROCESSES} from './programs.ts';
import {DEFAULT_FRAMES, PAGE_SIZE, VirtualSystem, type Process} from './system.ts';

/** The physical memory choices. In the last, the page tables are kept in the RAM itself, where they can be seen. */
const MEMORIES = [
  {label: '64 bytes', frames: DEFAULT_FRAMES, tablesInRam: false},
  {label: '128 bytes', frames: 2 * DEFAULT_FRAMES, tablesInRam: false},
  {label: '256 bytes with page tables', frames: 4 * DEFAULT_FRAMES, tablesInRam: true},
];

const SPEEDS = [0, 1, 5, 10, 50, 100, 500];
const MAX_STEPS_PER_FRAME = 200;
const STATE_TEXT = {stopped: 'not started', running: 'running', paused: 'paused', crashed: 'crashed'};
const TOGGLE_TEXT = {stopped: 'Start', running: 'Pause', paused: 'Resume', crashed: 'Start'};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') =>
  Object.assign(document.createElement(tag), {className, textContent: text});

const shadow = (access: Access | null, t: number) => {
  const a = flashLevel(access, t);
  if (!a) return '';
  return access!.kind === 'write'
    ? `inset 0 0 0 20px rgba(255,69,58,${a})`
    : `inset 0 0 0 20px rgba(255,214,10,${a * 0.75})`;
};

interface Card {
  el: HTMLElement;
  program: Program;
  listing: HTMLElement;
  inputs: HTMLInputElement[];
  state: HTMLElement;
  toggle: HTMLButtonElement;
  crash: HTMLElement;
  watches: HTMLElement[];
  regs: Record<'pc' | 'a' | 'b', HTMLElement>;
  rows: Map<number, HTMLElement>;
  cells: HTMLElement[];
}

/** The byte under the pointer, in whichever memory it is; `addr` is null when it is a page table entry. */
interface Hover {
  pid: number;
  page: number;
  addr: number | null;
  /** How many bytes from `addr`: 2 for an instruction. */
  len?: number;
}

class View {
  private readonly sys: VirtualSystem;
  /** Where each program has a breakpoint: the clock stops when any of them is about to run that address. */
  private readonly breakpoints: Set<number>[];
  private readonly cards: Card[] = [];
  private readonly frames: {box: HTMLElement; owner: HTMLElement; cells: HTMLElement[]}[] = [];
  private hover: Hover | null = null;

  constructor(sys: VirtualSystem, page: HTMLElement, breakpoints: Set<number>[]) {
    this.sys = sys;
    this.breakpoints = breakpoints;
    $('procs').replaceChildren(...sys.procs.map((p, i) => this.buildCard(p, i)));
    this.buildFrames();
    page.onmouseover = e => this.pointAt(e);
    page.onmouseleave = () => (this.hover = null);
    page.ondblclick = e => this.edit(e);
  }

  private pointAt(e: MouseEvent) {
    const instruction = (e.target as Element).closest<HTMLElement>('.ad[data-addr]')?.dataset;
    if (instruction) {
      const addr = Number(instruction.addr);
      this.hover = {pid: Number(instruction.pid), page: addr >> 2, addr, len: 2};
      return;
    }
    const d = (e.target as Element).closest<HTMLElement>('.c')?.dataset;
    if (d?.kind === 'virtual') {
      this.hover = {pid: Number(d.pid), page: Number(d.addr) >> 2, addr: Number(d.addr)};
    } else if (d?.kind === 'frame') {
      const own = this.sys.owner[Number(d.frame)];
      const off = Number(d.off);
      if (!own) this.hover = null;
      else if (own.kind === 'page') {
        this.hover = {pid: own.pid, page: own.page, addr: own.page * PAGE_SIZE + off};
      } else this.hover = {pid: own.pid, page: own.part * PAGE_SIZE + off, addr: null};
    } else this.hover = null;
  }

  /** Double-clicking a byte of a program's memory, or of the RAM, lets you change it. */
  private edit(e: MouseEvent) {
    const cell = (e.target as Element).closest<HTMLElement>('.c');
    const d = cell?.dataset;
    if (!cell || !d) return;
    const {sys} = this;
    if (d.kind === 'virtual') {
      const pid = Number(d.pid);
      const addr = Number(d.addr);
      const value = sys.peek(pid, addr);
      if (value !== null && sys.procs[pid].state !== 'crashed') {
        editByte(cell, value, v => sys.poke(pid, addr, v));
      }
    } else if (d.kind === 'frame') {
      const index = Number(d.frame) * PAGE_SIZE + Number(d.off);
      if (sys.owner[Number(d.frame)]) editByte(cell, sys.ram[index], v => sys.pokeFrame(index, v));
    }
  }

  /** The frame behind the hovered address, if it has one. */
  private hoveredFrame() {
    const h = this.hover;
    return h ? this.sys.procs[h.pid].table[h.page] : -1;
  }

  /** Shows the process just added to the system. */
  addCard(pid: number) {
    $('procs').append(this.buildCard(this.sys.procs[pid], pid));
  }

  private buildCard(proc: Process, pid: number) {
    const card = h('article', 'card');
    card.style.setProperty('--tone', procColor(pid));
    card.style.setProperty('--strong', procColor(pid, true));
    const head = h('div', 'chead');
    head.append(
      Object.assign(h('i', 'chip'), {style: `background:${procColor(pid, true)}`}),
      h('h2', '', `P${pid + 1} ${proc.def.name}`),
    );
    const state = head.appendChild(h('span', 'state'));

    const controls = h('div', 'controls');
    const toggle = Object.assign(h('button', 'toggle'), {onclick: () => this.sys.toggle(pid)});
    const reset = Object.assign(h('button', '', 'Reset'), {
      title: 'Stop the program and free its frames',
      onclick: () => this.sys.reset(pid),
    });
    controls.append(toggle, reset);

    const inputs = (proc.def.params ?? []).map(param => {
      const input = Object.assign(h('input', 'hexin'), {
        type: 'text',
        size: 4,
        spellcheck: false,
        title: 'A hexadecimal number, 0x00 to 0xFF. Change it while the program is not started.',
        onchange: () => {
          const v = parseInt(input.value.replace(/^0x/i, ''), 16);
          if (v >= 0 && v <= 255) this.sys.setParam(pid, param.key, v);
          input.value = hex(this.sys.procs[pid].values[param.key]);
        },
      });
      input.dataset.key = param.key;
      const label = h('label', 'param');
      label.append(h('span', '', param.label), input);
      controls.append(label);
      return input;
    });

    const watches = proc.def.watch.map(w => {
      const box = h('div', 'watch');
      box.append(h('span', 'wl', w.label), h('b', 'wv'));
      return box;
    });
    const regs = h('div', 'regs');
    const regEls = {pc: h('b'), a: h('b'), b: h('b')};
    for (const [name, el] of Object.entries(regEls)) regs.append(h('span', '', name.toUpperCase()), el);
    const crash = h('div', 'crash');

    const listing = h('div', 'listing');
    attachTooltip(listing);
    const rows = new Map<number, HTMLElement>();
    this.fillListing(pid, proc.program, listing, rows);

    const grid = h('div', 'vgrid');
    grid.append(h('div', 'hd'));
    for (let c = 0; c < 16; c++) grid.append(h('div', 'hd', c.toString(16).toUpperCase()));
    const cells: HTMLElement[] = [];
    for (let r = 0; r < 16; r++) {
      grid.append(h('div', 'hd', hex2(r * 16)));
      for (let c = 0; c < 16; c++) {
        const addr = r * 16 + c;
        const cell = h('div', 'c');
        cell.dataset.kind = 'virtual';
        cell.dataset.pid = String(pid);
        cell.dataset.addr = String(addr);
        cells.push(cell);
        grid.append(cell);
      }
    }

    const memory = h('div', 'memory');
    memory.append(h('h3', '', 'Its memory: 256 bytes, addresses 0x00 to 0xFF'), grid);

    card.append(
      head,
      h('p', 'blurb', proc.def.blurb),
      controls,
      h('div', 'watches'),
      regs,
      memory,
      crash,
      listing,
    );
    card.querySelector('.watches')!.append(...watches);
    this.cards.push({
      el: card,
      program: proc.program,
      listing,
      inputs,
      state,
      toggle,
      crash,
      watches,
      regs: regEls,
      rows,
      cells,
    });
    return card;
  }

  private fillListing(pid: number, program: Program, listing: HTMLElement, rows: Map<number, HTMLElement>) {
    listing.replaceChildren();
    rows.clear();
    for (const it of program.items) {
      if (it.kind === 'label') listing.append(h('div', 'lbl', it.name + ':'));
      else if (it.kind === 'ins') {
        const row = h('div', 'ins');
        row.dataset.op = String(it.bytes[0]);
        row.dataset.arg = String(it.bytes[1]);
        if (it.symbol) {
          row.dataset.symbol = it.symbol.name;
          row.dataset.symbolAddr = String(it.symbol.addr);
        }
        const address = Object.assign(h('span', 'ad', hex(it.addr)), {
          title: 'Click to stop the clock when this program gets here. Click again to remove.',
          onclick: () => {
            if (!this.breakpoints[pid].delete(it.addr)) this.breakpoints[pid].add(it.addr);
          },
        });
        address.dataset.pid = String(pid);
        address.dataset.addr = String(it.addr);
        row.append(address, h('span', 'asm', it.text), h('span', 'cm', it.comment ? '; ' + it.comment : ''));
        listing.append(row);
        rows.set(it.addr, row);
      }
    }
  }

  private buildFrames() {
    $('frames').replaceChildren(
      ...Array.from({length: this.sys.frames}, (_, f) => {
        const box = h('div', 'frame');
        const head = h('div', 'fhead');
        head.append(h('b', '', `F${f}`), h('span', 'fowner'));
        const bytes = h('div', 'fbytes');
        const cells = Array.from({length: PAGE_SIZE}, (_, i) => {
          const cell = bytes.appendChild(h('div', 'c'));
          cell.dataset.kind = 'frame';
          cell.dataset.frame = String(f);
          cell.dataset.off = String(i);
          return cell;
        });
        box.append(head, bytes);
        this.frames.push({box, owner: head.lastElementChild as HTMLElement, cells});
        return box;
      }),
    );
  }

  render(t: number) {
    const {sys} = this;
    const count = sys.procs.length;
    if ($('procs').dataset.count !== String(count)) $('procs').dataset.count = String(count);
    sys.procs.forEach((proc, pid) => this.renderCard(proc, pid, t));
    this.renderFrames(t);
    setText($('physTitle'), `Physical memory: ${sys.frames * PAGE_SIZE} bytes`);
    setText($('usage'), `${sys.framesInUse} of ${sys.frames} frames in use`);
  }

  private renderCard(proc: Process, pid: number, t: number) {
    const {sys} = this;
    const card = this.cards[pid];
    const loaded = proc.state !== 'stopped';
    const crashed = proc.state === 'crashed';
    card.state.className = 'state ' + proc.state;
    setText(card.state, STATE_TEXT[proc.state]);
    setText(card.toggle, TOGGLE_TEXT[proc.state]);
    card.toggle.disabled = crashed;
    setText(card.crash, crashed ? `Crashed: ${proc.crash}.` : '');

    const cpu = proc.cpu;
    setText(card.regs.pc, loaded ? hex(cpu.pc) : '–');
    setText(card.regs.a, loaded ? String(cpu.a) : '–');
    setText(card.regs.b, loaded ? String(cpu.b) : '–');
    proc.def.watch.forEach((w, i) => {
      const v = w.reg
        ? loaded
          ? cpu[w.reg]
          : null
        : proc.frozen
          ? proc.frozen[w.addr!]
          : sys.peek(pid, w.addr!);
      setText(card.watches[i].querySelector('.wv')!, v === null ? '–' : w.hex ? hex(v) : String(v));
    });

    for (const [addr, row] of card.rows) {
      const cls =
        'ins' +
        (this.breakpoints[pid].has(addr) ? ' bp' : '') +
        (loaded && !crashed && addr === cpu.pc ? ' next' : '') +
        (proc.state === 'running' && addr === proc.lastPc ? ' cur' : '');
      if (row.className !== cls) row.className = cls;
    }

    if (card.program !== proc.program) {
      card.program = proc.program;
      this.fillListing(pid, proc.program, card.listing, card.rows);
    }
    for (const input of card.inputs) {
      input.disabled = proc.state !== 'stopped';
      const text = hex(proc.values[input.dataset.key!]);
      if (document.activeElement !== input && input.value !== text) input.value = text;
    }

    card.cells.forEach((cell, addr) => {
      const frame = proc.table[addr >> 2];
      const ghost = proc.frozen?.[addr] ?? null;
      const mapped = frame >= 0;
      let cls = 'c';
      if (ghost !== null) cls += ' ghost';
      else if (mapped)
        cls += proc.program.codeAddrs.has(addr) ? ' m code' : proc.names[addr] ? ' m var' : ' m';
      else cls += ' u';
      if (addr % 4 === 0) cls += ' pg';
      if (loaded && !crashed && addr === cpu.pc) cls += ' pc';
      const hv = this.hover;
      if (
        hv?.pid === pid &&
        (hv.addr === null ? hv.page === addr >> 2 : addr >= hv.addr && addr < hv.addr + (hv.len ?? 1))
      ) {
        cls += ' hl';
      }
      if (cell.className !== cls) cell.className = cls;
      setText(
        cell,
        ghost !== null ? hex2(ghost) : mapped ? hex2(sys.ram[frame * PAGE_SIZE + (addr & 3)]) : '',
      );
      const sh = mapped ? shadow(proc.access[addr], t) : '';
      if (cell.style.boxShadow !== sh) cell.style.boxShadow = sh;
      if (addr % 4 === 0) {
        const title =
          proc.frozen?.[addr] != null
            ? `${hex(addr)}: this memory no longer exists. The program crashed and its frames were freed.`
            : mapped
              ? `${hex(addr)} is physical ${hex(frame * PAGE_SIZE)}, in frame ${frame}`
              : `${hex(addr)} has no frame: nothing is stored here`;
        if (cell.title !== title) cell.title = title;
      }
    });
  }

  private renderFrames(t: number) {
    const {sys} = this;
    const hv = this.hover;
    const hoveredFrame = this.hoveredFrame();
    this.frames.forEach((fr, f) => {
      const own = sys.owner[f];
      const isTable = own?.kind === 'table';
      const cls = 'frame' + (own ? '' : ' free') + (isTable ? ' table' : '');
      if (fr.box.className !== cls) fr.box.className = cls;
      fr.box.style.setProperty('--tone', own ? procColor(own.pid) : 'transparent');
      fr.box.style.setProperty('--strong', own ? procColor(own.pid, true) : 'transparent');
      setText(
        fr.owner,
        !own ? 'free' : isTable ? `P${own.pid + 1} table` : `P${own.pid + 1} · ${hex(own.page * PAGE_SIZE)}`,
      );
      fr.cells.forEach((cell, i) => {
        const at = f * PAGE_SIZE + i;
        const lit =
          hv &&
          (isTable
            ? own.pid === hv.pid && own.part * PAGE_SIZE + i === hv.page
            : f === hoveredFrame &&
              (hv.addr === null || (i >= (hv.addr & 3) && i < (hv.addr & 3) + (hv.len ?? 1))));
        const cls = 'c' + (lit ? ' hl' : '');
        if (cell.className !== cls) cell.className = cls;
        setText(cell, own ? hex2(sys.ram[at]) : '');
        const sh = own ? shadow(sys.ramAccess[at], t) : '';
        if (cell.style.boxShadow !== sh) cell.style.boxShadow = sh;
        let title = '';
        if (isTable) {
          const page = own.part * PAGE_SIZE + i;
          const entry = sys.ram[at];
          title = `P${own.pid + 1} page table, entry for ${hex(page * PAGE_SIZE)}–${hex(page * PAGE_SIZE + 3)}: ${entry ? `frame ${entry & 0x7f}` : 'no frame'}`;
        }
        if (cell.title !== title) cell.title = title;
      });
    });
  }
}

export const mount: Mount = (root, signal) => {
  root.innerHTML = html;
  const page = root.querySelector<HTMLElement>('.vm')!;
  const breakpoints: Set<number>[] = [];
  let speedIdx = 3;
  let memory = MEMORIES[0];
  let sys = new VirtualSystem([], memory);
  let view = new View(sys, page, breakpoints);
  let budget = 0;
  let last = 0;

  const speedBox = $('speed');
  const showSpeed = () =>
    [...speedBox.children].forEach(b =>
      b.classList.toggle('on', (b as HTMLElement).dataset.i === String(speedIdx)),
    );
  const stepButton = Object.assign(h('button', '', '>|'), {
    title: 'Step one tick: an instruction of every running program',
    onclick: () => {
      speedIdx = 0;
      budget = 0;
      showSpeed();
      sys.step();
      stepButton.blur();
    },
  });
  speedBox.append(stepButton);
  SPEEDS.forEach((ips, i) => {
    const b = h('button', '', String(ips));
    b.dataset.i = String(i);
    b.onclick = () => {
      speedIdx = i;
      budget = 0;
      showSpeed();
      b.blur();
    };
    speedBox.append(b);
  });
  showSpeed();

  const strip = $('strip');
  PROCESSES.forEach((def, pid) => {
    const b = h('button', 'pill');
    b.append(Object.assign(h('i', 'chip'), {style: `background:${procColor(pid, true)}`}), def.name);
    b.title = 'Add a process running this program. Shift-click to start it as well. It can be added again.';
    b.onclick = e => {
      b.blur();
      const id = sys.spawn(def);
      breakpoints.push(new Set());
      view.addCard(id);
      if (e.shiftKey) sys.toggle(id);
    };
    strip.append(b);
  });

  const memBox = $('memsize');
  const showMemory = () =>
    [...memBox.children].forEach((b, i) => b.classList.toggle('on', MEMORIES[i] === memory));
  MEMORIES.forEach(choice => {
    const b = h('button', '', choice.label);
    b.onclick = () => {
      b.blur();
      if (choice === memory) return;
      const old = sys;
      memory = choice;
      sys = new VirtualSystem(
        old.procs.map(proc => proc.def),
        memory,
      );
      old.procs.forEach((proc, pid) => {
        for (const [key, value] of Object.entries(proc.values)) sys.setParam(pid, key, value);
      });
      view = new View(sys, page, breakpoints);
      showMemory();
    };
    memBox.append(b);
  });
  showMemory();

  /**
   * With one or two programs the cards scale up, by the largest factor that still fits the window without
   * scrolling (and keeps each card about as wide as its two-column layout wants).
   */
  function fitZoom() {
    const procs = $('procs');
    const count = sys.procs.length;
    procs.style.setProperty('--zoom', '1');
    if (count === 0 || count >= 3) return;
    const doc = document.documentElement;
    const real = (procs.clientWidth - 14 * (count - 1)) / count;
    const max = Math.min(2.2, real / 880);
    const min = 0.8;
    const fits = (z: number) => {
      procs.style.setProperty('--zoom', String(z));
      return doc.scrollHeight <= window.innerHeight;
    };
    if (max <= min || fits(max)) return;
    let lo = min;
    let hi = max;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    procs.style.setProperty('--zoom', String(lo));
  }

  let fitted = '';

  function frame(t: number) {
    if (signal.aborted) return;
    const dt = Math.min(100, t - last) / 1000;
    last = t;
    const ips = SPEEDS[speedIdx];
    if (ips > 0) {
      budget += dt * ips;
      let n = 0;
      while (budget >= 1 && n < MAX_STEPS_PER_FRAME) {
        sys.step();
        budget--;
        n++;
        const hit = sys.procs.some(
          (p, pid) => p.state === 'running' && p.cpu.next === 'fetch' && breakpoints[pid].has(p.cpu.pc),
        );
        if (hit) {
          speedIdx = 0;
          showSpeed();
          budget = 0;
          break;
        }
      }
      if (n >= MAX_STEPS_PER_FRAME) budget = 0;
    }
    view.render(t);
    const crashed = sys.procs.some(p => p.state === 'crashed');
    const states = sys.procs.map(p => p.state).join();
    const layout = [sys.procs.length, memory.frames, crashed, states, innerWidth, innerHeight].join();
    if (layout !== fitted) {
      fitted = layout;
      fitZoom();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};
