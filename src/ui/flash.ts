import type {Access, Machine} from '../machine/machine.ts';

const FLASH_MS = 700;

export function flashLevel(f: Access | null, t: number) {
  const age = f ? t - f.t : Infinity;
  return age < FLASH_MS ? 1 - age / FLASH_MS : 0;
}

export function bindFlash(el: HTMLElement, m: Machine, addr: number) {
  return (t: number) => {
    const f = m.access[addr];
    const a = flashLevel(f, t);
    const bg = !a ? '' : f!.kind === 'write' ? `rgba(255,69,58,${a * 0.6})` : `rgba(255,214,10,${a * 0.4})`;
    if (el.style.background !== bg) el.style.background = bg;
  };
}
