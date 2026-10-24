import {hex} from '../../machine/format.ts';
import type {Machine} from '../../machine/machine.ts';
import {$, setText} from '../../ui/dom.ts';
import {bindFlash} from '../../ui/flash.ts';
import type {DemoView, Session} from '../demo.ts';
import {CUR, PROC_SIZE, SLOT_SIZE, TABLE, procBase, slotAddr, procColor} from './concurrency.ts';

const chip = (i: number) => `<i class="chip" style="background:${procColor(i, true)}"></i>`;

function fmtSlot(field: number, v: number) {
  if (field === 0 || field === 4) return hex(v);
  if (field === 3) return (v & 1 ? 'Z' : '-') + (v & 2 ? 'N' : '-');
  return String(v);
}

interface ProcRow {
  tr: HTMLElement;
  count: Element;
  rate: Element;
}

export class ConcurrencyView implements DemoView {
  private readonly m: Machine;
  private readonly n: number;
  private readonly updaters: ((t: number) => void)[] = [];
  private readonly rows: ProcRow[] = [];
  private readonly tally: number[];
  private readonly lastSeen: number[];
  private hist: {t: number; tally: number[]}[] = [];

  constructor({machine}: Session, n: number) {
    this.m = machine;
    this.n = n;
    this.tally = Array(n).fill(0);
    this.lastSeen = Array(n).fill(0);
    this.buildSlots();
    this.buildProcs();
    $('nearWrap').onclick = () => {
      for (let i = 0; i < n; i++) {
        machine.write(procBase(i), 0xf0);
        machine.write(procBase(i) + 1, 0xff);
        this.lastSeen[i] = 0xf0;
      }
    };
  }

  private buildSlots() {
    const m = this.m;
    $('varsTitle').textContent = 'Process table (in RAM)';
    const table = $('vars');
    table.className = 'slots';
    table.innerHTML =
      '<tr><th>Process</th><th>Slot</th><th>PC</th><th>A</th><th>B</th><th>Flags</th><th>Next</th></tr>';
    for (let i = 0; i < this.n; i++) {
      const s = slotAddr(i);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${chip(i)}P${i + 1}</td><td>${hex(s)}</td>` + '<td class="n"></td>'.repeat(5);
      table.appendChild(tr);
      for (let j = 0; j < 5; j++) {
        const td = tr.children[2 + j] as HTMLElement;
        this.updaters.push(bindFlash(td, m, s + j), () => setText(td, fmtSlot(j, m.mem[s + j])));
      }
      this.updaters.push(() => tr.classList.toggle('cur', m.mem[CUR] === s));
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>CUR</td><td>${hex(CUR)}</td><td colspan="5" class="dim" style="font-family:system-ui">the slot of the current process</td>`;
    table.appendChild(tr);
    this.updaters.push(bindFlash(tr, m, CUR));
  }

  private buildProcs() {
    const table = $('ptab');
    table.innerHTML = '<tr><th>Process</th><th>Memory</th><th>Count</th><th>Counts / sec</th></tr>';
    for (let i = 0; i <= this.n; i++) {
      const total = i === this.n;
      const tr = document.createElement('tr');
      tr.className = total ? 'tot' : '';
      tr.innerHTML = total
        ? '<td>All</td><td></td><td></td><td class="n"></td>'
        : `<td>${chip(i)}P${i + 1}</td><td class="mem">${hex(procBase(i))}–${hex(procBase(i) + PROC_SIZE - 3)}</td><td class="n big"></td><td class="n"></td>`;
      table.appendChild(tr);
      this.rows.push({tr, count: tr.children[2], rate: tr.children[3]});
    }
  }

  render(t: number) {
    const {m, n, tally, lastSeen, hist} = this;
    const running = m.kernel ? -1 : (m.mem[CUR] - TABLE) / SLOT_SIZE;
    for (let i = 0; i < n; i++) {
      const lo = m.mem[procBase(i)];
      tally[i] += (lo - lastSeen[i]) & 255;
      lastSeen[i] = lo;
    }
    if (!hist.length || t - hist[hist.length - 1].t >= 200) hist.push({t, tally: tally.slice()});
    while (hist.length > 1 && t - hist[0].t > 2500) hist.shift();
    const old = hist[0];
    const secs = (t - old.t) / 1000;
    let totalRate = 0;
    for (let i = 0; i < n; i++) {
      const rate = secs > 0.3 ? (tally[i] - old.tally[i]) / secs : 0;
      const row = this.rows[i];
      row.tr.classList.toggle('on', i === running);
      setText(row.count, String(m.mem[procBase(i) + 1] * 256 + m.mem[procBase(i)]));
      setText(row.rate, rate.toFixed(1));
      totalRate += rate;
    }
    setText(this.rows[n].rate, totalRate.toFixed(1));
    for (const f of this.updaters) f(t);
  }
}
