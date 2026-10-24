import type {Program} from '../machine/assembler';
import {hex, hex2} from '../machine/format';
import type {Machine} from '../machine/machine';

export class Listing {
  private readonly el: HTMLElement;
  private rowByAddr = new Map<number, HTMLElement>();
  private shownCur: number | null = null;
  private shownNext: number | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  build(program: Program) {
    this.el.innerHTML = '';
    this.rowByAddr.clear();
    this.shownCur = this.shownNext = null;
    const rows = document.createElement('div');
    rows.id = 'rows';
    this.el.appendChild(rows);
    let sec: HTMLElement | null = null;
    let prevKind: string | null = null;
    for (const it of program.items) {
      const d = document.createElement('div');
      if (it.kind === 'note') {
        d.className = 'note';
        d.textContent = it.text;
      } else if (it.kind === 'label') {
        d.className = 'lbl';
        d.textContent = it.name + ':';
      } else {
        d.className = 'ins';
        d.innerHTML = `<span class="ad">${hex(it.addr)}</span><span class="by">${hex2(it.bytes[0])} ${hex2(it.bytes[1])}</span><span class="asm"></span><span class="cm"></span>`;
        d.children[2].textContent = it.text;
        d.children[3].textContent = it.comment ? '; ' + it.comment : '';
        d.dataset.op = String(it.bytes[0]);
        this.rowByAddr.set(it.addr, d);
      }
      if (!sec || it.kind === 'note' || (it.kind === 'label' && prevKind !== 'note')) {
        sec = document.createElement('div');
        sec.className = 'sec';
        rows.appendChild(sec);
      }
      sec.appendChild(d);
      prevKind = it.kind;
    }
    this.el.scrollTop = 0;
  }

  update(m: Machine, follow: boolean) {
    const cur = m.next === 'fetch' ? null : m.executing;
    const next = m.next === 'fetch' ? m.pc : null;
    if (cur !== this.shownCur) {
      this.row(this.shownCur)?.classList.remove('cur');
      this.row(cur)?.classList.add('cur');
      this.shownCur = cur;
    }
    if (next !== this.shownNext) {
      this.row(this.shownNext)?.classList.remove('next');
      this.row(next)?.classList.add('next');
      this.shownNext = next;
    }
    const row = this.row(cur ?? next);
    if (row && follow) {
      const el = this.el;
      const top = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      if (top < el.scrollTop + 20 || top > el.scrollTop + el.clientHeight - 40) {
        el.scrollTop = top - el.clientHeight / 2;
      }
    }
  }

  private row(addr: number | null) {
    return addr === null ? undefined : this.rowByAddr.get(addr);
  }
}
