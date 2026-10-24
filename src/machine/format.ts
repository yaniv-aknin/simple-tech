export const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
export const hex = (v: number) => '0x' + hex2(v);
