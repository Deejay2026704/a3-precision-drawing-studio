import { describe, expect, it } from 'vitest';
import { STANDARD_SCALES, formatScale, pageLengthToWorld, parseScale, scaleFactor, worldLengthToPage } from '../src/geometry/scale';
import { createEmptyDocument, setDocumentScale } from '../src/model/document';
import { createLine, createRect } from '../src/model/shapes';
import { vec } from '../src/geometry/vec';

describe('drawing scale', () => {
  it('offers the standard scales 1:1, 1:2, 1:5, 1:10, 1:20, 1:50, 1:100', () => {
    expect(STANDARD_SCALES.map(formatScale)).toEqual(['1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100']);
  });

  it.each([
    [1, 1000, 1000],
    [2, 1000, 500],
    [5, 1000, 200],
    [10, 1000, 100],
    [20, 1000, 50],
    [50, 1000, 20],
    [100, 1000, 10],
  ])('at 1:%i a %i mm object is %i mm on paper', (real, world, paper) => {
    const s = { paper: 1, real };
    expect(worldLengthToPage(world, s)).toBeCloseTo(paper, 12);
    expect(pageLengthToWorld(paper, s)).toBeCloseTo(world, 12);
  });

  it('supports custom scales, including enlargements', () => {
    expect(parseScale('1:25')).toEqual({ paper: 1, real: 25 });
    expect(parseScale(' 1 / 250 ')).toEqual({ paper: 1, real: 250 });
    expect(parseScale('2:1')).toEqual({ paper: 2, real: 1 });
    expect(parseScale('75')).toEqual({ paper: 1, real: 75 });
    expect(parseScale('1:0')).toBeNull();
    expect(parseScale('abc')).toBeNull();
    expect(parseScale('-1:5')).toBeNull();
    expect(scaleFactor({ paper: 2, real: 1 })).toBe(2);
    expect(worldLengthToPage(10, { paper: 2, real: 1 })).toBe(20);
  });

  it('the A3 sheet covers 21 m × 14.85 m at 1:50', () => {
    const s = { paper: 1, real: 50 };
    expect(pageLengthToWorld(420, s)).toBe(21000);
    expect(pageLengthToWorld(297, s)).toBe(14850);
  });

  it('changing the scale never changes the actual geometry', () => {
    const shapes = [createLine('l', vec(0, 0), vec(5000, 0)), createRect('r', vec(100, 200), 3000, 1500, 12)];
    const doc = { ...createEmptyDocument(), shapes };
    const scaled = setDocumentScale(doc, { paper: 1, real: 50 });
    expect(scaled.scale).toEqual({ paper: 1, real: 50 });
    expect(scaled.shapes).toEqual(shapes);
    const back = setDocumentScale(scaled, { paper: 1, real: 1 });
    expect(back.shapes).toEqual(shapes);
  });

  it('rejects invalid scales', () => {
    expect(() => setDocumentScale(createEmptyDocument(), { paper: 1, real: 0 })).toThrow(RangeError);
    expect(() => scaleFactor({ paper: NaN, real: 1 })).toThrow(RangeError);
  });
});
