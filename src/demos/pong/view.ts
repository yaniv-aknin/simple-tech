import {hex} from '../../machine/format';
import {Keyboard} from '../../machine/keyboard';
import type {Machine} from '../../machine/machine';
import {$, setText} from '../../ui/dom';
import {bindFlash} from '../../ui/flash';
import type {DemoView, Session} from '../demo';
import {ADDR, VAR_INFO} from './pong';

const GW = 16;
const GH = 12;
const CELL = 24;

export class PongView implements DemoView {
  readonly keyboard: Keyboard;
  private readonly m: Machine;
  private readonly ctx = $<HTMLCanvasElement>('screen').getContext('2d')!;
  private readonly score = $('score');
  private readonly updaters: ((t: number) => void)[] = [];
  private lastScore = 0;
  private flashUntil = 0;

  constructor({machine}: Session) {
    this.m = machine;
    this.keyboard = new Keyboard(machine, ADDR.KEY);
    $('varsTitle').textContent = 'Variables the screen reads';
    const table = $('vars');
    table.innerHTML = '';
    table.className = '';
    for (const [name, addr] of Object.entries(ADDR) as [keyof typeof ADDR, number][]) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${name}</td><td>${hex(addr)}</td><td class="v"></td><td>${VAR_INFO[name]}</td>`;
      table.appendChild(tr);
      this.updaters.push(bindFlash(tr, machine, addr), () =>
        setText(tr.children[2], String(machine.mem[addr])),
      );
    }
  }

  render(t: number) {
    this.draw(t);
    setText(this.score, String(this.m.mem[ADDR.SCORE]));
    for (const f of this.updaters) f(t);
  }

  private draw(t: number) {
    const m = this.m.mem;
    const ctx = this.ctx;
    const score = m[ADDR.SCORE];
    if (score > this.lastScore) this.flashUntil = t + 250;
    this.lastScore = score;
    ctx.fillStyle = '#05080d';
    ctx.fillRect(0, 0, GW * CELL, GH * CELL);
    ctx.fillStyle = t < this.flashUntil ? '#ffd60a' : '#3a4a66';
    ctx.fillRect(0, 0, GW * CELL, CELL);
    ctx.fillRect(0, 0, CELL, GH * CELL);
    ctx.fillRect((GW - 1) * CELL, 0, CELL, GH * CELL);
    ctx.fillStyle = '#5ac8fa';
    ctx.fillRect(m[ADDR.PX] * CELL, (GH - 1) * CELL, 3 * CELL, CELL);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(m[ADDR.BX] * CELL + 2, m[ADDR.BY] * CELL + 2, CELL - 4, CELL - 4);
  }
}
