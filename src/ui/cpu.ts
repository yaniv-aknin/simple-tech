import {hex, hex2} from '../machine/format.ts';
import {opSpec} from '../machine/isa.ts';
import type {Machine, Phase} from '../machine/machine.ts';
import {$, setText} from './dom.ts';

const PHASES: Phase[] = ['fetch', 'execute', 'timer'];
const bits = (v: number) => v.toString(2).padStart(8, '0') + '  ' + hex(v);

export class CpuPanel {
  private readonly el = {
    mode: $('cmode'),
    timer: $('ctimer'),
    pc: $('pc'),
    ir: $('ir'),
    irx: $('irx'),
    a: $('a'),
    b: $('b'),
    abits: $('abits'),
    bbits: $('bbits'),
    fz: $('fz'),
    fn: $('fn'),
    msg: $('msg'),
    stats: $('stats'),
  };
  private readonly phases = PHASES.map(p => [p, $('ph-' + p)] as const);

  render(m: Machine) {
    const el = this.el;
    setText(el.mode, m.kernel ? 'KERNEL' : 'USER');
    setText(
      el.timer,
      m.kernel
        ? 'the kernel is running; the timer is off'
        : `timer: ${m.timer} of ${m.interrupt?.quantum ?? 0} instructions`,
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
    setText(el.msg, m.msg);
    setText(
      el.stats,
      `Instructions run: ${m.instrCount}. A real laptop does about 3,000,000,000 per second.`,
    );
  }
}
