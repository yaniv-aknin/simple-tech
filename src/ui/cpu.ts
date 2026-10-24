import {hex, hex2} from '../machine/format.ts';
import {opSpec} from '../machine/isa.ts';
import type {Machine, Phase} from '../machine/machine.ts';
import {setText} from './dom.ts';

const PHASES: Phase[] = ['fetch', 'execute', 'timer'];
const bits = (v: number) => v.toString(2).padStart(8, '0') + '  ' + hex(v);

/** What identifies each core: the colour of its title chip, of its program counter in the RAM, and of its row. */
export const CORE_HUES = [205, 335, 40, 130];
export const coreColor = (k: number) => `hsl(${CORE_HUES[k]} 65% 55%)`;

const TEMPLATE = `
  <h2><i class="chip"></i><span data-r="title"></span></h2>
  <div class="phases">
    <span data-r="ph-fetch">1 FETCH</span><span data-r="ph-execute">2 EXECUTE</span
    ><span data-r="ph-timer" class="ph-timer">TIMER</span>
  </div>
  <div class="reg r-mode">
    <span class="rn">MODE</span><span class="rv" data-r="mode"></span><span class="rx" data-r="timer"></span>
  </div>
  <div class="reg r-pc">
    <span class="rn">PC</span><span class="rv" data-r="pc"></span
    ><span class="rx">address of the next instruction</span>
  </div>
  <div class="reg r-ir">
    <span class="rn">IR</span><span class="rv" data-r="ir"></span><span class="rx" data-r="irx"></span>
  </div>
  <div class="reg">
    <span class="rn">A</span><span class="rv" data-r="a"></span><span class="rx bits" data-r="abits"></span>
  </div>
  <div class="reg">
    <span class="rn">B</span><span class="rv" data-r="b"></span><span class="rx bits" data-r="bbits"></span>
  </div>
  <div class="flags">
    <span class="flag" data-r="fz"><i>Z</i>A is zero</span>
    <span class="flag" data-r="fn"><i>N</i>A is negative (128+)</span>
  </div>
`;

/** One core's registers and what it is doing. */
export class CpuPanel {
  private readonly el: Record<string, HTMLElement>;
  private readonly phases: (readonly [Phase, HTMLElement])[];

  constructor(parent: HTMLElement, title: string, core: number) {
    const root = document.createElement('section');
    root.className = 'panel cpu';
    root.innerHTML = TEMPLATE;
    parent.append(root);
    this.el = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-r]')].map(e => [e.dataset.r!, e]),
    );
    root.querySelector<HTMLElement>('h2 .chip')!.style.background = coreColor(core);
    this.el.title.textContent = title;
    this.phases = PHASES.map(p => [p, this.el['ph-' + p]] as const);
  }

  render(m: Machine) {
    const el = this.el;
    setText(el.mode, m.kernel ? 'KERNEL' : 'USER');
    setText(
      el.timer,
      m.kernel ? 'timer is off' : `timer: ${m.timer} of ${m.interrupt?.quantum ?? 0} instructions`,
    );
    setText(el.pc, hex(m.pc));
    setText(el.ir, `${hex2(m.ir[0])} ${hex2(m.ir[1])}`);
    setText(el.irx, m.lastPhase ? `${opSpec(m.ir[0]).name} ${m.ir[1]}` : 'the instruction being worked on');
    setText(el.a, String(m.a));
    setText(el.b, String(m.b));
    setText(el.abits, bits(m.a));
    setText(el.bbits, bits(m.b));
    el.fz.classList.toggle('on', !!m.z);
    el.fn.classList.toggle('on', !!m.n);
    for (const [p, span] of this.phases) span.classList.toggle('on', m.lastPhase === p);
  }
}
