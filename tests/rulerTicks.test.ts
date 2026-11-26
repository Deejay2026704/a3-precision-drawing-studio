import { describe, expect, it } from 'vitest';
import { niceStep, rulerTicks } from '../src/render/rulerTicks';

describe('ruler ticks', () => {
  it('chooses 1-2-5 steps that are at least the minimum pixel spacing', () => {
    expect(niceStep(3.78, 60)).toBe(20);
    expect(niceStep(0.0378, 60)).toBe(2000);
    expect(niceStep(37.8, 60)).toBe(2);
  });

  it('major ticks fall on multiples of the step', () => {
    const t = rulerTicks(0, 420, 3.78);
    const majors = t.filter((x) => x.major).map((x) => x.value);
    expect(majors.slice(0, 4)).toEqual([0, 20, 40, 60]);
    expect(majors).toContain(420);
  });
});
