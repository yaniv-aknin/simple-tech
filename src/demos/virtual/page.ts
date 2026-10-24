import './page.css';
import {hex, hex2} from '../../machine/format.ts';
import type {Program} from '../../machine/assembler.ts';
import type {Access} from '../../machine/machine.ts';
import {$, setText} from '../../ui/dom.ts';
import {flashLevel} from '../../ui/flash.ts';
import {initTheme} from '../../theme.ts';
import {procColor} from '../concurrency/concurrency.ts';
import {PROCESSES} from './programs.ts';
import {FRAME_CHOICES, PAGE_SIZE, PAGES, VirtualSystem, type Process} from './system.ts';

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
  tableBody: HTMLElement;
  tableCount: HTMLElement;
  tableKey: string;
}

interface Hover {
  pid: number;
  page: number;
}

class View {
  private readonly sys: VirtualSystem;
  private readonly cards: Card[] = [];
  private readonly frames: {box: HTMLElement; owner: HTMLElement; cells: HTMLElement[]}[] = [];
  private hover: Hover | null = null;

  constructor(sys: VirtualSystem) {
    this.sys = sys;
    $('procs').replaceChildren(...sys.procs.map((p, i) => this.buildCard(p, i)));
    this.buildFrames();
    $('procs').onmouseover = e => this.pointAt(e);
    $('frames').onmouseover = e => this.pointAt(e);
    for (const id of ['procs', 'frames']) $(id).onmouseleave = () => (this.hover = null);
  }

  private pointAt(e: MouseEvent) {
    const target = (e.target as Element).closest<HTMLElement>('[data-pid]');
    this.hover = target ? {pid: Number(target.dataset.pid), page: Number(target.dataset.page)} : null;
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
    const rows = new Map<number, HTMLElement>();
    this.fillListing(proc.program, listing, rows);

    const grid = h('div', 'vgrid');
    grid.append(h('div', 'hd'));
    for (let c = 0; c < 16; c++) grid.append(h('div', 'hd', c.toString(16).toUpperCase()));
    const cells: HTMLElement[] = [];
    for (let r = 0; r < 16; r++) {
      grid.append(h('div', 'hd', hex2(r * 16)));
      for (let c = 0; c < 16; c++) {
        const addr = r * 16 + c;
        const cell = h('div', 'c');
        cell.dataset.pid = String(pid);
        cell.dataset.page = String(addr >> 2);
        cells.push(cell);
        grid.append(cell);
      }
    }

    const memory = h('div', 'memory');
    memory.append(h('h3', '', 'Its memory: 256 bytes, addresses 0x00 to 0xFF'), grid);

    const table = h('div', 'ptable');
    const tableCount = table.appendChild(h('h3'));
    const body = table.appendChild(h('div', 'prows'));

    card.append(
      head,
      h('p', 'blurb', proc.def.blurb),
      controls,
      h('div', 'watches'),
      regs,
      memory,
      crash,
      table,
      listing,
    );
    card.querySelector('.watches')!.append(...watches);
    this.cards.push({
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
      tableBody: body,
      tableCount,
      tableKey: '',
    });
    return card;
  }

  private fillListing(program: Program, listing: HTMLElement, rows: Map<number, HTMLElement>) {
    listing.replaceChildren();
    rows.clear();
    for (const it of program.items) {
      if (it.kind === 'label') listing.append(h('div', 'lbl', it.name + ':'));
      else if (it.kind === 'ins') {
        const row = h('div', 'ins');
        row.append(h('span', 'ad', hex(it.addr)), h('span', 'asm', it.text), h('span', 'cm', it.comment));
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
        const cells = Array.from({length: PAGE_SIZE}, () => bytes.appendChild(h('div', 'c')));
        box.append(head, bytes);
        this.frames.push({box, owner: head.lastElementChild as HTMLElement, cells});
        return box;
      }),
    );
  }

  render(t: number) {
    const {sys} = this;
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
        (loaded && !crashed && addr === cpu.pc ? ' next' : '') +
        (proc.state === 'running' && addr === proc.lastPc ? ' cur' : '');
      if (row.className !== cls) row.className = cls;
    }

    if (card.program !== proc.program) {
      card.program = proc.program;
      this.fillListing(proc.program, card.listing, card.rows);
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
      if (this.hover?.pid === pid && this.hover.page === addr >> 2) cls += ' hl';
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

    const key = proc.table.join(',');
    if (key !== card.tableKey) {
      card.tableKey = key;
      this.buildTable(proc, pid, card);
    }
    card.tableBody.querySelectorAll<HTMLElement>('.prow').forEach(row => {
      row.classList.toggle('hl', this.hover?.pid === pid && this.hover.page === Number(row.dataset.page));
    });
  }

  private buildTable(proc: Process, pid: number, card: Card) {
    const rows: HTMLElement[] = [];
    proc.table.forEach((frame, page) => {
      if (frame < 0) return;
      const row = h('div', 'prow');
      row.dataset.pid = String(pid);
      row.dataset.page = String(page);
      const from = page * PAGE_SIZE;
      row.append(
        h('span', '', `${hex(from)}–${hex(from + 3)}`),
        h('span', 'arrow', '→'),
        h('span', '', `frame ${frame}`),
        h('span', 'dim', `(${hex(frame * PAGE_SIZE)}–${hex(frame * PAGE_SIZE + 3)})`),
      );
      rows.push(row);
    });
    setText(card.tableCount, `Page table: ${rows.length} of ${PAGES} pages have a frame`);
    card.tableBody.replaceChildren(...rows);
  }

  private renderFrames(t: number) {
    const {sys} = this;
    this.frames.forEach((fr, f) => {
      const own = sys.owner[f];
      const hovered = this.hover && own && own.pid === this.hover.pid && own.page === this.hover.page;
      const cls = 'frame' + (own ? '' : ' free') + (hovered ? ' hl' : '');
      if (fr.box.className !== cls) fr.box.className = cls;
      fr.box.style.setProperty('--tone', own ? procColor(own.pid) : 'transparent');
      fr.box.style.setProperty('--strong', own ? procColor(own.pid, true) : 'transparent');
      if (own) {
        fr.box.dataset.pid = String(own.pid);
        fr.box.dataset.page = String(own.page);
      } else {
        delete fr.box.dataset.pid;
        delete fr.box.dataset.page;
      }
      setText(fr.owner, own ? `P${own.pid + 1} · ${hex(own.page * PAGE_SIZE)}` : 'free');
      fr.cells.forEach((cell, i) => {
        const at = f * PAGE_SIZE + i;
        setText(cell, own ? hex2(sys.ram[at]) : '');
        const sh = own ? shadow(sys.ramAccess[at], t) : '';
        if (cell.style.boxShadow !== sh) cell.style.boxShadow = sh;
      });
    });
  }
}

/* ---------- running ---------- */

initTheme();

let speedIdx = 3;
let frames = FRAME_CHOICES[0];
let sys = new VirtualSystem(PROCESSES, frames);
let view = new View(sys);
let budget = 0;
let last = 0;

const speedBox = $('speed');
const showSpeed = () => [...speedBox.children].forEach((b, i) => b.classList.toggle('on', i === speedIdx));
SPEEDS.forEach((ips, i) => {
  const b = h('button', '', String(ips));
  b.onclick = () => {
    speedIdx = i;
    budget = 0;
    showSpeed();
    b.blur();
  };
  speedBox.append(b);
});
showSpeed();

const memBox = $('memsize');
const showMemory = () => {
  [...memBox.children].forEach((b, i) => b.classList.toggle('on', FRAME_CHOICES[i] === frames));
};
FRAME_CHOICES.forEach(choice => {
  const b = h('button', '', `${choice * PAGE_SIZE} bytes`);
  b.onclick = () => {
    b.blur();
    if (choice === frames) return;
    const old = sys;
    frames = choice;
    sys = new VirtualSystem(PROCESSES, frames);
    old.procs.forEach((proc, pid) => {
      for (const [key, value] of Object.entries(proc.values)) sys.setParam(pid, key, value);
    });
    view = new View(sys);
    showMemory();
  };
  memBox.append(b);
});
showMemory();

$('tables').onclick = () => {
  const hidden = document.body.classList.toggle('no-tables');
  $('tables').textContent = hidden ? 'Show page tables' : 'Hide page tables';
  $('tables').blur();
};

function frame(t: number) {
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
    }
    if (n >= MAX_STEPS_PER_FRAME) budget = 0;
  }
  view.render(t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
