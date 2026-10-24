import type {Session} from '../demos/demo.ts';
import {hex, hex2} from '../machine/format.ts';
import type {Machine} from '../machine/machine.ts';
import {setText} from './dom.ts';
import {editByte} from './edit.ts';
import {flashLevel} from './flash.ts';

export class RamGrid {
  private readonly cells: HTMLElement[] = [];
  private bases: string[] = [];
  private machine: Machine | null = null;
  private kernelEnd = 0;
  private kernelHidden = false;
  private colors: string[] = [];
  private blanked: boolean[] = [];
  private lit: {addr: number; len: number} | null = null;

  constructor(el: HTMLElement) {
    const div = (className: string, textContent = '') =>
      el.appendChild(Object.assign(document.createElement('div'), {className, textContent}));
    div('h');
    for (let c = 0; c < 16; c++) div('h', c.toString(16).toUpperCase());
    for (let r = 0; r < 16; r++) {
      div('h', hex2(r * 16));
      for (let c = 0; c < 16; c++) this.cells.push(div(''));
    }
    el.addEventListener('dblclick', e => {
      const addr = this.cells.indexOf(e.target as HTMLElement);
      const m = this.machine;
      if (addr >= 0 && m) editByte(this.cells[addr], m.mem[addr], value => m.write(addr, value));
    });
  }

  /** Outlines `len` bytes from `addr`, or nothing for null. */
  highlight(addr: number | null, len = 2) {
    this.lit = addr === null ? null : {addr, len};
  }

  /** Blanks out the RAM below the demo's `kernelEnd`, which holds the kernel's code and tables. */
  hideKernel(hidden: boolean) {
    this.kernelHidden = hidden;
  }

  build({program, machine, setup}: Session) {
    this.machine = machine;
    this.kernelEnd = setup.kernelEnd ?? 0;
    this.colors = this.cells.map((_, a) => setup.cellColor(a));
    this.blanked = this.cells.map(() => false);
    this.bases = this.cells.map((d, a) => {
      d.title = hex(a) + machine.nm(a);
      d.style.background = this.colors[a];
      return program.codeAddrs.has(a) ? 'c code' : machine.names[a] ? 'c var' : 'c';
    });
  }

  /** The cores share the RAM, so any of them shows it; each marks its own PC and IR. */
  render(cores: Machine[], t: number) {
    const m = cores[0];
    const marks = cores.map((core, k) => {
      const fetching = core.next === 'fetch';
      const ir = fetching || core.executing === null ? [] : [core.executing, (core.executing + 1) & 255];
      return {k, pc: fetching ? core.pc : -1, ir};
    });
    this.cells.forEach((cell, i) => {
      const blank = this.kernelHidden && i < this.kernelEnd;
      if (blank !== this.blanked[i]) {
        this.blanked[i] = blank;
        cell.style.background = blank ? 'none' : this.colors[i];
      }
      if (blank) {
        setText(cell, '');
        if (cell.className !== 'c hidden') cell.className = 'c hidden';
        if (cell.style.boxShadow) cell.style.boxShadow = '';
        return;
      }
      setText(cell, hex2(m.mem[i]));
      let cls = this.bases[i];
      if (this.lit && i >= this.lit.addr && i < this.lit.addr + this.lit.len) cls += ' hl';
      for (const {k, pc, ir} of marks) {
        if (i === pc) cls += ` pc${k}`;
        if (ir.includes(i)) cls += ` ir${k}`;
      }
      if (cell.className !== cls) cell.className = cls;
      const f = m.access[i];
      const a = flashLevel(f, t);
      const shadow = !a
        ? ''
        : f!.kind === 'write'
          ? `inset 0 0 0 20px rgba(255,69,58,${a})`
          : `inset 0 0 0 20px rgba(255,214,10,${a * 0.75})`;
      if (cell.style.boxShadow !== shadow) cell.style.boxShadow = shadow;
    });
  }
}
