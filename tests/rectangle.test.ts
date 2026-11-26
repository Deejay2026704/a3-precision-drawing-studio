import { describe, expect, it } from 'vitest';
import { createRect, createRectFromCorners, rectArea, rectCorners, shapeBounds } from '../src/model/shapes';
import { setRectSize } from '../src/model/operations';
import { vec, vecApproxEqual } from '../src/geometry/vec';

describe('rectangle dimensions', () => {
  it('builds a rectangle from two corners in any order', () => {
    const r1 = createRectFromCorners('r', vec(10, 20), vec(110, 70));
    const r2 = createRectFromCorners('r', vec(110, 70), vec(10, 20));
    const r3 = createRectFromCorners('r', vec(110, 20), vec(10, 70));
    for (const r of [r1, r2, r3]) {
      expect(r.origin).toEqual(vec(10, 20));
      expect(r.width).toBe(100);
      expect(r.height).toBe(50);
      expect(r.rotationDeg).toBe(0);
    }
  });

  it('reports exact corners, area and bounds', () => {
    const r = createRect('r', vec(10, 20), 100, 50);
    expect(rectCorners(r)).toEqual([vec(10, 20), vec(110, 20), vec(110, 70), vec(10, 70)]);
    expect(rectArea(r)).toBe(5000);
    expect(shapeBounds(r)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it('setting width/height keeps the base corner', () => {
    const r = setRectSize(createRect('r', vec(10, 20), 100, 50), 42.5, 17.25);
    expect(r.origin).toEqual(vec(10, 20));
    expect(r.width).toBe(42.5);
    expect(r.height).toBe(17.25);
  });

  it('a rotated rectangle keeps its width and height', () => {
    const r = createRect('r', vec(0, 0), 100, 50, 90);
    const c = rectCorners(r);
    expect(vecApproxEqual(c[1], vec(0, 100))).toBe(true);
    expect(vecApproxEqual(c[2], vec(-50, 100))).toBe(true);
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
  });

  it('rejects negative sizes', () => {
    expect(() => createRect('r', vec(0, 0), -1, 5)).toThrow(RangeError);
    expect(() => setRectSize(createRect('r', vec(0, 0), 1, 5), 1, -5)).toThrow(RangeError);
  });
});
