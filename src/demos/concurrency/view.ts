import {hex} from '../../machine/format.ts';
import type {Machine} from '../../machine/machine.ts';
import {$, setText} from '../../ui/dom.ts';
import {bindFlash} from '../../ui/flash.ts';
import type {DemoView, Session} from '../demo.ts';
import {PROC_SIZE, SLOT_SIZE, TABLE, coreOf, curAddr, procBase, slotAddr, procColor} from './concurrency.ts';

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
  private readonly cores: Machine[];
  private readonly n: number;
  private readonly updaters: ((t: number) => void)[] = [];
  private readonly rows: ProcRow[] = [];
  private readonly tally: number[];
  private readonly lastSeen: number[];
  private hist: {t: number; tally: number[]}[] = [];

  constructor({machine, cores}: Session, n: number) {
    this.m = machine;
    this.cores = cores;
    this.n = n;
    this.tally = Array(n).fill(0);
    this.lastSeen = Array(n).fill(0);
    this.buildSlots();
    this.buildProcs();
    $('nearWrap').onclick = () => {
      for (let i = 0; i < n; i++) {
        machine.write(procBase(i), 0xf0);
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
    const busy = Math.min(this.cores.length, this.n);
    for (let i = 0; i < this.n; i++) {
      const s = slotAddr(i);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${chip(i)}P${i + 1}</td><td>${hex(s)}</td>` + '<td class="n"></td>'.repeat(5);
      table.appendChild(tr);
      for (let j = 0; j < 5; j++) {
        const td = tr.children[2 + j] as HTMLElement;
        this.updaters.push(bindFlash(td, m, s + j), () => setText(td, fmtSlot(j, m.mem[s + j])));
      }
      this.updaters.push(() => {
        let current = false;
        for (let k = 0; k < busy; k++) current ||= m.mem[curAddr(k)] === s;
        tr.classList.toggle('cur', current);
      });
    }
    for (let k = 0; k < busy; k++) {
      const tr = document.createElement('tr');
      const name = this.cores.length === 1 ? 'CUR' : `CUR${k + 1}`;
      const what =
        this.cores.length === 1
          ? 'the slot of the current process'
          : `the slot of the process on core ${k + 1}`;
      tr.innerHTML = `<td>${name}</td><td>${hex(curAddr(k))}</td><td colspan="5" class="dim" style="font-family:system-ui">${what}</td>`;
      table.appendChild(tr);
      this.updaters.push(bindFlash(tr, m, curAddr(k)));
    }
  }

  private buildProcs() {
    const table = $('ptab');
    const multi = this.cores.length > 1;
    const header = multi
      ? '<tr><th>Process</th><th>Memory</th><th>Core</th><th>Count</th><th>Counts / sec</th></tr>'
      : '<tr><th>Process</th><th>Memory</th><th>Count</th><th>Counts / sec</th></tr>';
    table.innerHTML = header;
    const extra = multi ? 1 : 0;
    for (let i = 0; i <= this.n; i++) {
      const total = i === this.n;
      const tr = document.createElement('tr');
      tr.className = total ? 'tot' : '';
      const core = multi ? `<td>${total ? '' : `Core ${coreOf(i, this.cores.length) + 1}`}</td>` : '';
      tr.innerHTML = total
        ? `<td>All</td><td></td>${core}<td></td><td class="n"></td>`
        : `<td>${chip(i)}P${i + 1}</td><td class="mem">${hex(procBase(i))}–${hex(procBase(i) + PROC_SIZE - 3)}</td>${core}<td class="n big"></td><td class="n"></td>`;
      table.appendChild(tr);
      this.rows.push({tr, count: tr.children[2 + extra], rate: tr.children[3 + extra]});
    }
  }

  render(t: number) {
    const {m, n, tally, lastSeen, hist} = this;
    const running = new Set<number>();
    for (let k = 0; k < Math.min(this.cores.length, n); k++) {
      const core = this.cores[k];
      if (!core.kernel) running.add((m.mem[curAddr(k)] - TABLE) / SLOT_SIZE);
    }
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
      row.tr.classList.toggle('on', running.has(i));
      setText(row.count, String(m.mem[procBase(i)]));
      setText(row.rate, rate.toFixed(1));
      totalRate += rate;
    }
    setText(this.rows[n].rate, totalRate.toFixed(1));
    for (const f of this.updaters) f(t);
  }
}
