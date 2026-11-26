import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument, duplicateItems, removeItems, replaceShapes } from '../src/model/document';
import {
  applyDimensionGrip,
  createAngularDimension,
  createLinearDimension,
  createRadialDimension,
  distanceToDimensionLayout,
  formatDimensionValue,
  layoutDimension,
  measureDimension,
} from '../src/model/dimensions';
import { moveShape, rotateShape, setCircleRadius, setLineLength } from '../src/model/operations';
import { createCircle, createLine, createRect } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE as S, type Dimension, type DrawingDocument, type Shape } from '../src/model/types';

const docOf = (shapes: Shape[], dimensions: Dimension[] = []): DrawingDocument => ({ ...createEmptyDocument(), shapes, dimensions });
const ok = <T>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const L = createLine('L', vec(10, 10), vec(40, 50)); // length 50, dx 30, dy 40
const C = createCircle('C', vec(100, 100), 25);
const ref = (shapeId: string, key: string) => ({ kind: 'shape' as const, shapeId, key });

describe('dimension values', () => {
  const doc = docOf([L, C]);

  it('aligned, horizontal and vertical measure the true, X and Y distances', () => {
    expect(measureDimension(doc, ok(createLinearDimension(doc, 'a', 'aligned', ref('L', 'start'), ref('L', 'end'), vec(0, 60), S)))).toBeCloseTo(50, 12);
    expect(measureDimension(doc, ok(createLinearDimension(doc, 'h', 'horizontal', ref('L', 'start'), ref('L', 'end'), vec(0, 60), S)))).toBe(30);
    expect(measureDimension(doc, ok(createLinearDimension(doc, 'v', 'vertical', ref('L', 'start'), ref('L', 'end'), vec(60, 0), S)))).toBe(40);
  });

  it('radius and diameter', () => {
    expect(measureDimension(doc, ok(createRadialDimension(doc, 'r', 'radius', 'C', vec(150, 100), S)))).toBe(25);
    expect(measureDimension(doc, ok(createRadialDimension(doc, 'd', 'diameter', 'C', vec(150, 100), S)))).toBe(50);
  });

  it('angular measures the angle of the picked quadrant', () => {
    const a = createLine('A', vec(0, 0), vec(100, 0));
    const b = createLine('B', vec(0, 0), vec(100, 100));
    const d = docOf([a, b]);
    expect(measureDimension(d, ok(createAngularDimension(d, 'g', 'A', 'B', vec(30, 10), S)))).toBeCloseTo(45, 10);
    // the obtuse side
    expect(measureDimension(d, ok(createAngularDimension(d, 'g', 'A', 'B', vec(-30, 10), S)))).toBeCloseTo(135, 10);
    // lines that only meet when extended
    const c = createLine('Cc', vec(50, 10), vec(50, 80));
    const d2 = docOf([a, c]);
    expect(measureDimension(d2, ok(createAngularDimension(d2, 'g', 'A', 'Cc', vec(60, 20), S)))).toBeCloseTo(90, 10);
  });

  it('refuses parallel lines, coincident points, non-circles and same line twice', () => {
    const a = createLine('A', vec(0, 0), vec(100, 0));
    const p = createLine('P', vec(0, 5), vec(100, 5));
    const d = docOf([a, p, C]);
    expect(createAngularDimension(d, 'g', 'A', 'P', vec(10, 2), S).ok).toBe(false);
    expect(createAngularDimension(d, 'g', 'A', 'A', vec(10, 2), S).ok).toBe(false);
    expect(createLinearDimension(d, 'x', 'aligned', ref('A', 'start'), { kind: 'point', point: vec(0, 0) }, vec(0, 5), S).ok).toBe(false);
    expect(createLinearDimension(d, 'x', 'horizontal', ref('A', 'start'), { kind: 'point', point: vec(0, 30) }, vec(0, 5), S).ok).toBe(false);
    expect(createRadialDimension(d, 'x', 'radius', 'A', vec(0, 0), S).ok).toBe(false);
  });

  it('formats with the configured precision and symbols', () => {
    expect(formatDimensionValue({ kind: 'aligned' }, 12.3456, 2)).toBe('12.35');
    expect(formatDimensionValue({ kind: 'aligned' }, 12, 0)).toBe('12');
    expect(formatDimensionValue({ kind: 'radius' }, 5, 1)).toBe('R5.0');
    expect(formatDimensionValue({ kind: 'diameter' }, 10, 3)).toBe('⌀10.000');
    expect(formatDimensionValue({ kind: 'angular' }, 45, 1)).toBe('45.0°');
    expect(formatDimensionValue({ kind: 'aligned' }, -0.0001, 2)).toBe('0.00');
  });
});

describe('associativity: dimensions follow edited geometry', () => {
  it('linear dimension updates when the line is moved, lengthened or rotated', () => {
    let doc = docOf([L]);
    const dim = ok(createLinearDimension(doc, 'a', 'aligned', ref('L', 'start'), ref('L', 'end'), vec(0, 60), S));
    doc = { ...doc, dimensions: [dim] };
    doc = replaceShapes(doc, [moveShape(L, 500, -3)]);
    expect(measureDimension(doc, dim)).toBeCloseTo(50, 12);
    doc = replaceShapes(doc, [setLineLength(doc.shapes[0] as typeof L, 72.5)]);
    expect(measureDimension(doc, dim)).toBeCloseTo(72.5, 12);
    doc = replaceShapes(doc, [rotateShape(doc.shapes[0], 33)]);
    expect(measureDimension(doc, dim)).toBeCloseTo(72.5, 10);
    // and the drawn dimension line still has the measured length
    const lay = layoutDimension(doc, dim, doc.scale)!;
    expect(lay.text).toBe('72.50');
  });

  it('radius dimension updates when the circle radius changes', () => {
    let doc = docOf([C]);
    const dim = ok(createRadialDimension(doc, 'r', 'radius', 'C', vec(0, 0), S));
    doc = replaceShapes({ ...doc, dimensions: [dim] }, [setCircleRadius(C, 31.25)]);
    expect(measureDimension(doc, dim)).toBe(31.25);
  });

  it('rectangle-corner dimension tracks rectangle resize', () => {
    const r = createRect('R', vec(0, 0), 40, 20);
    let doc = docOf([r]);
    const dim = ok(createLinearDimension(doc, 'w', 'horizontal', ref('R', 'c0'), ref('R', 'c1'), vec(20, -10), S));
    doc = replaceShapes({ ...doc, dimensions: [dim] }, [{ ...r, width: 55 }]);
    expect(measureDimension(doc, dim)).toBe(55);
  });

  it('a dimension whose geometry is missing reports no value instead of a wrong one', () => {
    const doc = docOf([], [{ id: 'r', kind: 'radius', mode: 'driven', style: S, textShift: 0, circleId: 'gone', angleDeg: 0 }]);
    expect(measureDimension(doc, doc.dimensions[0])).toBeNull();
    expect(layoutDimension(doc, doc.dimensions[0], doc.scale)).toBeNull();
  });

  it('deleting geometry removes and reports its dependent dimensions', () => {
    const doc = docOf([L, C], [ok(createRadialDimension(docOf([C]), 'r', 'radius', 'C', vec(0, 0), S))]);
    const res = removeItems(doc, ['C']);
    expect(res.doc.dimensions).toHaveLength(0);
    expect(res.dependentDimensions).toBe(1);
    expect(res.doc.shapes).toEqual([L]);
  });

  it('duplicating geometry with its dimension links the copy to the copied geometry', () => {
    let doc = docOf([L]);
    doc = { ...doc, dimensions: [ok(createLinearDimension(doc, 'a', 'aligned', ref('L', 'start'), ref('L', 'end'), vec(0, 60), S))] };
    let n = 0;
    const res = duplicateItems(doc, ['L', 'a'], () => `n${++n}`, vec(10, 0));
    expect(res.newIds).toEqual(['n1', 'n2']);
    const copy = res.doc.dimensions[1];
    expect(copy.kind === 'aligned' && copy.p1.kind === 'shape' && copy.p1.shapeId).toBe('n1');
  });
});

describe('dimension layout and placement', () => {
  it('extension lines, dimension line and arrows sit at the offset', () => {
    const h = createLine('H', vec(0, 0), vec(100, 0));
    const doc = docOf([h]);
    const dim = ok(createLinearDimension(doc, 'a', 'aligned', ref('H', 'start'), ref('H', 'end'), vec(50, 20), S));
    expect(dim.offset).toBe(20);
    const lay = layoutDimension(doc, dim, doc.scale)!;
    expect(lay.lines).toHaveLength(3);
    expect(lay.lines[2]).toEqual([vec(0, 20), vec(100, 20)]);
    expect(lay.arrows.map((a) => a.tip)).toEqual([vec(0, 20), vec(100, 20)]);
    // extension line: from gap above the point to overshoot beyond the dimension line
    expect(lay.lines[0][0]).toEqual(vec(0, 1));
    expect(lay.lines[0][1]).toEqual(vec(0, 21.5));
  });

  it('paper-sized text and arrows grow with the drawing scale (constant on paper)', () => {
    const h = createLine('H', vec(0, 0), vec(5000, 0));
    const doc = { ...docOf([h]), scale: { paper: 1, real: 50 } };
    const dim = ok(createLinearDimension(doc, 'a', 'aligned', ref('H', 'start'), ref('H', 'end'), vec(0, 500), S));
    const lay = layoutDimension(doc, dim, doc.scale)!;
    expect(lay.textHeight).toBeCloseTo(2.5 * 50, 12);
    expect(lay.arrowSize).toBeCloseTo(2.5 * 50, 12);
    expect(lay.value).toBe(5000); // value unaffected by scale
  });

  it('hiding extension lines removes them', () => {
    const h = createLine('H', vec(0, 0), vec(100, 0));
    const doc = docOf([h]);
    const dim = ok(createLinearDimension(doc, 'a', 'aligned', ref('H', 'start'), ref('H', 'end'), vec(50, 20), { ...S, showExtensionLines: false }));
    expect(layoutDimension(doc, dim, doc.scale)!.lines).toHaveLength(1);
  });

  it('grips change offset, text position, leader angle and arc radius without changing the value', () => {
    const h = createLine('H', vec(0, 0), vec(100, 0));
    const doc = docOf([h, C]);
    const lin = ok(createLinearDimension(doc, 'a', 'aligned', ref('H', 'start'), ref('H', 'end'), vec(50, 20), S));
    const moved = applyDimensionGrip(doc, lin, 'dimline', vec(10, -15));
    expect(moved.kind === 'aligned' && moved.offset).toBe(-15);
    const shifted = applyDimensionGrip(doc, lin, 'text', vec(70, 25));
    expect(shifted.textShift).toBe(20);
    expect(measureDimension(doc, moved)).toBe(100);
    const rad = ok(createRadialDimension(doc, 'r', 'radius', 'C', vec(200, 100), S));
    const turned = applyDimensionGrip(doc, rad, 'leader', vec(100, 150));
    expect(turned.kind === 'radius' && turned.angleDeg).toBeCloseTo(90, 12);
  });

  it('hit testing finds the dimension line and text but not empty space', () => {
    const h = createLine('H', vec(0, 0), vec(100, 0));
    const doc = docOf([h]);
    const lay = layoutDimension(doc, ok(createLinearDimension(doc, 'a', 'aligned', ref('H', 'start'), ref('H', 'end'), vec(50, 20), S)), doc.scale)!;
    expect(distanceToDimensionLayout(lay, vec(40, 20.3))).toBeCloseTo(0.3, 9);
    expect(distanceToDimensionLayout(lay, lay.textPos)).toBe(0);
    expect(distanceToDimensionLayout(lay, vec(50, 60))).toBeGreaterThan(30);
  });
});
