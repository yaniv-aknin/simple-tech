import {describe, expect, it} from 'vitest';
import {History, grownMax, linePath} from './chart.ts';

describe('grownMax', () => {
  it('doubles until it holds the peak', () => {
    expect(grownMax(1, 0.4)).toBe(1);
    expect(grownMax(1, 1.5)).toBe(2);
    expect(grownMax(1, 5)).toBe(8);
    expect(grownMax(2, 33)).toBe(64);
  });

  it('never shrinks', () => {
    expect(grownMax(16, 0)).toBe(16);
    expect(grownMax(16, 3)).toBe(16);
  });
});

describe('linePath', () => {
  const samples = [
    {t: 1000, values: [0, 10]},
    {t: 31000, values: [5, 10]},
  ];
  const first = (path: string) => path.split(' ')[0];

  it('puts the newest sample at the right edge and one from 30 seconds ago at the left', () => {
    const [start, end] = linePath(samples, 0, 31000, 30000, 10).split(' ');
    expect(start).toBe('M38.0,118.0');
    expect(end.startsWith('L392.0,')).toBe(true);
  });

  it('puts the largest value at the top and zero at the bottom', () => {
    expect(first(linePath(samples, 1, 31000, 30000, 10))).toBe('M38.0,10.0');
    expect(first(linePath(samples, 0, 31000, 30000, 10))).toBe('M38.0,118.0');
  });

  it('breaks the line where the series did not exist', () => {
    const gap = [
      {t: 0, values: [1, 1]},
      {t: 1000, values: [1]},
      {t: 2000, values: [1, 1]},
    ];
    expect(linePath(gap, 1, 2000, 30000, 2).match(/M/g)).toHaveLength(2);
    expect(linePath(gap, 0, 2000, 30000, 2).match(/M/g)).toHaveLength(1);
  });
});

describe('History', () => {
  it('keeps its samples, marks and scale across a mark, and forgets all of them on clear', () => {
    const h = new History(30000);
    h.push(1000, [3, 0]);
    h.mark(1500);
    h.push(2000, [0, 0]);
    const seen = h.within(2000);
    expect(seen.samples).toHaveLength(2);
    expect(seen.marks).toEqual([1500]);
    expect(h.max).toBe(4);
    h.push(3000, [0, 0]);
    expect(h.max).toBe(4);
    h.clear();
    expect(h.within(3100)).toEqual({samples: [], marks: []});
    expect(h.max).toBe(1);
  });

  it('has nothing to mark before there is history', () => {
    const h = new History(30000);
    h.mark(10);
    expect(h.within(20).marks).toEqual([]);
  });

  it('lets samples and marks go once they are older than the window', () => {
    const h = new History(30000);
    h.push(0, [1]);
    h.mark(100);
    h.push(40000, [1]);
    const seen = h.within(40000);
    expect(seen.samples.map(s => s.t)).toEqual([40000]);
    expect(seen.marks).toEqual([]);
  });

  it('does not let the scale shrink when the big values leave the window', () => {
    const h = new History(30000);
    h.push(0, [100]);
    h.push(60000, [1]);
    expect(h.within(60000).samples).toHaveLength(1);
    expect(h.max).toBe(128);
  });
});
