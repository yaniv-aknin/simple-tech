export const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
export const hex = (v: number) => '0x' + hex2(v);

/** The comment to show beside an instruction: its own, then what the name in its operand stands for. */
export function commentFor(it: {comment: string; symbol?: {name: string; addr: number}}) {
  const named = it.symbol ? `${it.symbol.name} = RAM ${hex(it.symbol.addr)}` : '';
  return [it.comment, named].filter(Boolean).join('. ');
}
