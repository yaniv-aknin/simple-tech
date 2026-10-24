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

  build({program, machine, setup}: Session) {
    this.machine = machine;
    this.bases = this.cells.map((d, a) => {
      d.title = hex(a) + machine.nm(a);
      d.style.background = setup.cellColor(a);
      return program.codeAddrs.has(a) ? 'c code' : machine.names[a] ? 'c var' : 'c';
    });
  }

  render(m: Machine, t: number) {
    const fetching = m.next === 'fetch';
    const ir = fetching || m.executing === null ? [] : [m.executing, (m.executing + 1) & 255];
    this.cells.forEach((cell, i) => {
      setText(cell, hex2(m.mem[i]));
      let cls = this.bases[i];
      if (fetching && i === m.pc) cls += ' pc';
      if (ir.includes(i)) cls += ' ir';
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
