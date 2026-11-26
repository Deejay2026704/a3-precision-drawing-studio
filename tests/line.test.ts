import { describe, expect, it } from 'vitest';
import { createLine, lineAngle, lineLength } from '../src/model/shapes';
import { setLineAngle, setLineLength } from '../src/model/operations';
import { vec } from '../src/geometry/vec';

describe('line length and angle', () => {
  it('computes length of horizontal, vertical and diagonal lines', () => {
    expect(lineLength(createLine('a', vec(10, 10), vec(110, 10)))).toBe(100);
    expect(lineLength(createLine('a', vec(10, 10), vec(10, 60)))).toBe(50);
    expect(lineLength(createLine('a', vec(0, 0), vec(30, 40)))).toBe(50);
  });

  it('computes the angle CCW from +X in a Y-up system', () => {
    expect(lineAngle(createLine('a', vec(0, 0), vec(10, 0)))).toBeCloseTo(0, 12);
    expect(lineAngle(createLine('a', vec(0, 0), vec(0, 10)))).toBeCloseTo(90, 12);
    expect(lineAngle(createLine('a', vec(0, 0), vec(-10, 0)))).toBeCloseTo(180, 12);
    expect(lineAngle(createLine('a', vec(0, 0), vec(0, -10)))).toBeCloseTo(270, 12);
    expect(lineAngle(createLine('a', vec(0, 0), vec(10, 10)))).toBeCloseTo(45, 12);
  });

  it('setting the length keeps start point and direction', () => {
    const l = setLineLength(createLine('a', vec(5, 5), vec(35, 45)), 100);
    expect(l.start).toEqual(vec(5, 5));
    expect(lineLength(l)).toBeCloseTo(100, 10);
    expect(lineAngle(l)).toBeCloseTo(Math.atan2(40, 30) * (180 / Math.PI), 10);
    expect(l.end.x).toBeCloseTo(65, 10);
    expect(l.end.y).toBeCloseTo(85, 10);
  });

  it('setting the angle keeps start point and length', () => {
    const l = setLineAngle(createLine('a', vec(10, 20), vec(110, 20)), 90);
    expect(l.start).toEqual(vec(10, 20));
    expect(l.end.x).toBeCloseTo(10, 10);
    expect(l.end.y).toBeCloseTo(120, 10);
    expect(lineLength(l)).toBeCloseTo(100, 10);
  });

  it('rejects negative lengths', () => {
    expect(() => setLineLength(createLine('a', vec(0, 0), vec(1, 0)), -1)).toThrow(RangeError);
  });
});
