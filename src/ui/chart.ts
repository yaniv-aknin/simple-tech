const SVG = 'http://www.w3.org/2000/svg';

const WIDTH = 400;
const HEIGHT = 150;
const PLOT = {x: 38, y: 10, w: 354, h: 108};

export interface Sample {
  t: number;
  /** One value per series that existed then; a series that did not exist has no entry. */
  values: number[];
}

/** The scale after seeing `peak`: it doubles until it holds it, and never gets smaller. */
export function grownMax(current: number, peak: number) {
  let max = current;
  while (max < peak) max *= 2;
  return max;
}

const xAt = (t: number, now: number, windowMs: number) => PLOT.x + PLOT.w * (1 - (now - t) / windowMs);

/**
 * The path of series `i`: time runs left to right, ending at `now`. Where the series did not exist the line
 * breaks, rather than joining the two sides.
 */
export function linePath(samples: Sample[], i: number, now: number, windowMs: number, max: number) {
  let path = '';
  let drawing = false;
  for (const s of samples) {
    const v = s.values[i];
    if (v === undefined) {
      drawing = false;
      continue;
    }
    const x = xAt(s.t, now, windowMs);
    const y = PLOT.y + PLOT.h * (1 - Math.min(v, max) / max);
    path += `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    drawing = true;
  }
  return path.trim();
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** What a chart remembers: samples and marks of the last stretch of time, and the scale it has grown to. */
export class History {
  samples: Sample[] = [];
  marks: number[] = [];
  max = 1;
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  push(t: number, values: number[]) {
    this.samples.push({t, values});
    this.max = grownMax(this.max, Math.max(0, ...values));
    while (this.samples.length > 1 && t - this.samples[0].t > this.windowMs + 1000) this.samples.shift();
  }

  /** Marks that something was changed now. There is nothing to mark on a chart with no history yet. */
  mark(t: number) {
    if (this.samples.length) this.marks.push(t);
  }

  /** Forgets everything, including how far the scale had grown. */
  clear() {
    this.samples = [];
    this.marks = [];
    this.max = 1;
  }

  /** What is still within the window at `now`. */
  within(now: number) {
    this.marks = this.marks.filter(t => now - t <= this.windowMs);
    return {samples: this.samples.filter(s => now - s.t <= this.windowMs), marks: this.marks};
  }
}

/**
 * A line chart of a few series over the last `seconds`. The scale only grows, a dashed line marks when something
 * was changed, and nothing is forgotten until `clear()`.
 */
export class RateChart {
  private readonly history: History;
  private readonly root: SVGSVGElement;
  private readonly lines: SVGPathElement[];
  private readonly labels: SVGTextElement[];
  private readonly markLines: SVGLineElement[] = [];
  private readonly windowMs: number;

  constructor(el: HTMLElement, colors: string[], seconds = 30) {
    this.windowMs = seconds * 1000;
    this.history = new History(this.windowMs);
    const root = svg('svg', {viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'chart'});
    this.root = root;
    this.labels = [1, 0.5, 0].map(f => {
      const y = PLOT.y + PLOT.h * (1 - f);
      root.append(svg('line', {class: 'grid', x1: PLOT.x, x2: PLOT.x + PLOT.w, y1: y, y2: y}));
      const label = svg('text', {x: PLOT.x - 5, y: y + 3, 'text-anchor': 'end'});
      root.append(label);
      return label;
    });
    const axis = (x: number, anchor: string, text: string) => {
      const label = svg('text', {x, y: HEIGHT - 8, 'text-anchor': anchor});
      label.textContent = text;
      root.append(label);
    };
    axis(PLOT.x, 'start', `${seconds} s ago`);
    axis(PLOT.x + PLOT.w, 'end', 'now');
    this.lines = colors.map(color => {
      const line = svg('path');
      line.style.stroke = color;
      root.append(line);
      return line;
    });
    el.replaceChildren(root);
  }

  push(t: number, values: number[]) {
    this.history.push(t, values);
  }

  mark(t: number) {
    this.history.mark(t);
  }

  clear() {
    this.history.clear();
  }

  render(now: number) {
    const {samples, marks} = this.history.within(now);
    const max = this.history.max;
    [max, max / 2, 0].forEach((v, k) => {
      this.labels[k].textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
    });
    this.lines.forEach((line, i) => line.setAttribute('d', linePath(samples, i, now, this.windowMs, max)));
    marks.forEach((t, k) => {
      let line = this.markLines[k];
      if (!line) {
        line = svg('line', {class: 'mark', y1: PLOT.y, y2: PLOT.y + PLOT.h});
        this.markLines.push(line);
        this.root.append(line);
      }
      const x = String(xAt(t, now, this.windowMs));
      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
      line.style.display = '';
    });
    for (const line of this.markLines.slice(marks.length)) line.style.display = 'none';
  }
}
