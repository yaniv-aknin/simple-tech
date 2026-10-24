import {hex, hex2} from '../machine/format.ts';
import {opSpec} from '../machine/isa.ts';

const binary = (v: number) => v.toString(2).padStart(8, '0');

/** Tooltips for the listing: what an instruction does (on its text), and its machine code in binary (on its bytes). */
export function attachTooltip(listing: HTMLElement) {
  const tip =
    document.getElementById('tip') ??
    document.body.appendChild(Object.assign(document.createElement('div'), {id: 'tip'}));

  let tipTarget: HTMLElement | null = null;
  let tipTimer = 0;

  const show = (target: HTMLElement) => {
    const row = target.closest<HTMLElement>('.ins')!;
    const op = Number(row.dataset.op);
    const arg = Number(row.dataset.arg);
    if (target.classList.contains('by')) {
      tip.innerHTML = `<div class="t">Machine code in binary</div>
        <code>${binary(op)} ${binary(arg)}</code>
        <div class="dim">Opcode ${hex2(op)} (${op}), then operand ${hex2(arg)} (${arg}).</div>`;
    } else {
      const spec = opSpec(op);
      tip.innerHTML = `<div class="t">Assembly reference · opcode ${hex2(op)}</div>
        <code>${spec.syntax}</code>
        <div>${spec.does}</div>
        <div class="dim">Flags: ${spec.flags}. Size: 2 bytes (opcode, operand).</div>`;
      if (row.dataset.symbol) {
        const addr = Number(row.dataset.symbolAddr);
        tip.innerHTML += `<div class="sym"><code>${row.dataset.symbol} = ${hex(addr)}</code>
          <div>A name for the RAM address ${hex(addr)} (${addr}), which this instruction uses.</div></div>`;
      }
    }
    tip.style.display = 'block';
    const r = target.getBoundingClientRect();
    const x = Math.min(r.left, innerWidth - tip.offsetWidth - 8);
    const below = r.bottom + 6 + tip.offsetHeight < innerHeight;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = (below ? r.bottom + 6 : r.top - tip.offsetHeight - 6) + 'px';
  };

  const hide = () => {
    clearTimeout(tipTimer);
    tipTarget = null;
    tip.style.display = 'none';
  };

  listing.addEventListener('mouseover', e => {
    const target = (e.target as Element).closest<HTMLElement>('.ins .asm, .ins .by');
    if (target === tipTarget) return;
    hide();
    if (!target) return;
    tipTarget = target;
    tipTimer = setTimeout(() => show(target), 100);
  });
  listing.addEventListener('mouseleave', hide);
}
