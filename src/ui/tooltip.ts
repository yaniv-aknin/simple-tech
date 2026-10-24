import {hex2} from '../machine/format.ts';
import {opSpec} from '../machine/isa.ts';

export function attachTooltip(listing: HTMLElement) {
  const tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);

  let tipRow: HTMLElement | null = null;
  let tipTimer = 0;

  const show = (row: HTMLElement) => {
    const op = Number(row.dataset.op);
    const spec = opSpec(op);
    tip.innerHTML = `<div class="t">Assembly reference · opcode ${hex2(op)}</div>
      <code>${spec.syntax}</code>
      <div>${spec.does}</div>
      <div class="dim">Flags: ${spec.flags}. Size: 2 bytes (opcode, operand).</div>`;
    tip.style.display = 'block';
    const r = row.getBoundingClientRect();
    const x = Math.min(r.left + 60, innerWidth - tip.offsetWidth - 8);
    const below = r.bottom + 6 + tip.offsetHeight < innerHeight;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = (below ? r.bottom + 6 : r.top - tip.offsetHeight - 6) + 'px';
  };

  const hide = () => {
    clearTimeout(tipTimer);
    tipRow = null;
    tip.style.display = 'none';
  };

  listing.addEventListener('mouseover', e => {
    const row = (e.target as Element).closest<HTMLElement>('.ins');
    if (row === tipRow) return;
    hide();
    if (!row) return;
    tipRow = row;
    tipTimer = setTimeout(() => show(row), 100);
  });
  listing.addEventListener('mouseleave', hide);
}
