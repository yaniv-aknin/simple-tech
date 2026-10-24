export interface CLine {
  n: number;
  text: string;
  tag: string | null;
}

/** Splits C source into lines, pulling out the trailing `//@tag` that links a line to its assembly. */
export function parseC(src: string): CLine[] {
  return src.split('\n').map((raw, i) => {
    const m = raw.match(/\s*\/\/@(\w+)\s*$/);
    return {n: i + 1, text: (m ? raw.slice(0, m.index) : raw).trimEnd(), tag: m ? m[1] : null};
  });
}
