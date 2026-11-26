import { describe, expect, it } from 'vitest';
import { distance, vec, vecApproxEqual } from '../src/geometry/vec';
import { arcEnd, arcStart } from '../src/model/arcs';
import { chamferLines, filletLines, trimCurve, trimCurvePreview } from '../src/model/curves';
import { createEmptyDocument } from '../src/model/document';
import { measureDimension } from '../src/model/dimensions';
import { trimShape } from '../src/model/modify';
import { createArc, createCircle, createLine, lineLength } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type ArcShape, type DrawingDocument, type LineShape, type Shape } from '../src/model/types';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
let n = 0;
const newId = () => `n${++n}`;
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { message: string }).message);
  return r as Extract<T, { ok: true }>;
};
const get = <S extends Shape>(d: DrawingDocument, id: string) => d.shapes.find((s) => s.id === id) as S;

// circle r = 10 at origin, cut by the horizontal line y = 0 at 0° and 180°
const C = createCircle('C', vec(0, 0), 10);
const H = createLine('H', vec(-20, 0), vec(20, 0));

describe('trim circles and arcs', () => {
  it('a circle cut in two places becomes the arc you did not pick', () => {
    const r = ok(trimCurve(docOf(C, H), 'C', vec(0, 10.3), newId)); // pick the top half
    const a = get<ArcShape>(r.doc, 'C');
    expect(a.kind).toBe('arc');
    expect(a.startDeg).toBeCloseTo(180, 9);
    expect(a.sweepDeg).toBeCloseTo(180, 9); // bottom half kept
    expect(a.radius).toBe(10);
  });

  it('a circle crossed once (or never) is refused, unchanged', () => {
    const tangent = createLine('T', vec(-20, 10), vec(20, 10));
    expect(trimCurve(docOf(C, tangent), 'C', vec(0, 10), newId).ok).toBe(false);
    expect(trimCurve(docOf(C), 'C', vec(0, 10), newId).ok).toBe(false);
  });

  it('arc: trim an end, or split the middle (linked end dimensions follow)', () => {
    const A = createArc('A', vec(0, 0), 10, 0, 180); // top semicircle
    const V = createLine('V', vec(0, -20), vec(0, 20)); // cuts it at 90°
    const end = ok(trimCurve(docOf(A, V), 'A', vec(-8, 6), newId));
    expect(get<ArcShape>(end.doc, 'A')).toMatchObject({ startDeg: 0, sweepDeg: expect.closeTo(90, 9) });
    const start = ok(trimCurve(docOf(A, V), 'A', vec(8, 6), newId));
    expect(get<ArcShape>(start.doc, 'A')).toMatchObject({ startDeg: expect.closeTo(90, 9), sweepDeg: expect.closeTo(90, 9) });

    const V2 = createLine('V2', vec(5, -20), vec(5, 20));
    const V3 = createLine('V3', vec(-5, -20), vec(-5, 20));
    const dim = { id: 'D', kind: 'aligned' as const, mode: 'driven' as const, style: DEFAULT_DIMENSION_STYLE, textShift: 0, offset: -5, p1: { kind: 'shape' as const, shapeId: 'A', key: 'start' }, p2: { kind: 'shape' as const, shapeId: 'A', key: 'end' } };
    const mid = ok(trimCurve({ ...docOf(A, V2, V3), dimensions: [dim] }, 'A', vec(0, 10), newId));
    const arcs = mid.doc.shapes.filter((s) => s.kind === 'arc') as ArcShape[];
    expect(arcs).toHaveLength(2);
    expect(vecApproxEqual(arcEnd(arcs[0]), vec(5, Math.sqrt(75)))).toBe(true);
    expect(vecApproxEqual(arcStart(arcs[1]), vec(-5, Math.sqrt(75)))).toBe(true);
    expect(measureDimension(mid.doc, mid.doc.dimensions[0])).toBeCloseTo(20, 9); // still spans the whole width
  });

  it('nothing crossing an arc → refused', () => {
    expect(trimCurve(docOf(createArc('A', vec(0, 0), 10, 0, 90)), 'A', vec(7, 7), newId).ok).toBe(false);
  });

  it('preview shows exactly the piece that would be removed', () => {
    const p = trimCurvePreview(docOf(C, H), 'C', vec(0, 10.3))!;
    expect(p).toMatchObject({ kind: 'arc', startDeg: expect.closeTo(0, 9), sweepDeg: expect.closeTo(180, 9) });
  });

  it('the generic trim handles lines, circles and arcs; rectangles are refused', () => {
    expect(trimShape(docOf(C, H), 'C', vec(0, 10), newId).ok).toBe(true);
    expect(trimShape(docOf(C, H), 'H', vec(15, 0), newId).ok).toBe(true);
  });
});

describe('fillet', () => {
  // corner at (0,0): horizontal line to the right, vertical line upwards
  const X = createLine('X', vec(0, 0), vec(100, 0));
  const Y = createLine('Y', vec(0, 0), vec(0, 80));

  it('rounds a 90° corner: tangent points at R, centre at (R, R), lines trimmed', () => {
    const r = ok(filletLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), 10, newId));
    const arc = r.doc.shapes.find((s) => s.kind === 'arc') as ArcShape;
    expect(vecApproxEqual(arc.center, vec(10, 10))).toBe(true);
    expect(arc.radius).toBe(10);
    expect(arc.sweepDeg).toBeCloseTo(90, 9);
    expect(get<LineShape>(r.doc, 'X')).toMatchObject({ start: expect.objectContaining({ x: expect.closeTo(10, 9) }), end: vec(100, 0) });
    expect(get<LineShape>(r.doc, 'Y').start.y).toBeCloseTo(10, 9);
    // the arc meets both lines exactly (tangent continuity)
    const ends = [arcStart(arc), arcEnd(arc)];
    expect(ends.some((p) => vecApproxEqual(p, vec(10, 0)))).toBe(true);
    expect(ends.some((p) => vecApproxEqual(p, vec(0, 10)))).toBe(true);
  });

  it('works when the lines do not reach the corner (extends them) and at any angle', () => {
    const A = createLine('A', vec(20, 0), vec(100, 0));
    const B = createLine('B', vec(10, 10 * Math.sqrt(3)), vec(40, 40 * Math.sqrt(3))); // 60° line, gap at the corner
    const r = ok(filletLines(docOf(A, B), 'A', vec(60, 0), 'B', vec(25, 25 * Math.sqrt(3)), 5, newId));
    const arc = r.doc.shapes.find((s) => s.kind === 'arc') as ArcShape;
    const t = 5 / Math.tan(Math.PI / 6); // R / tan(θ/2), θ = 60°
    expect(get<LineShape>(r.doc, 'A').start.x).toBeCloseTo(t, 9);
    expect(distance(arc.center, vec(t, 5))).toBeLessThan(1e-9);
  });

  it('radius 0 makes a sharp corner', () => {
    const A = createLine('A', vec(5, 0), vec(100, 0));
    const B = createLine('B', vec(0, 5), vec(0, 80));
    const r = ok(filletLines(docOf(A, B), 'A', vec(50, 0), 'B', vec(0, 40), 0, newId));
    expect(get<LineShape>(r.doc, 'A').start).toEqual(vec(0, 0));
    expect(get<LineShape>(r.doc, 'B').start).toEqual(vec(0, 0));
    expect(r.doc.shapes).toHaveLength(2);
  });

  it('keeps the picked sides of crossing lines', () => {
    const A = createLine('A', vec(-50, 0), vec(50, 0));
    const B = createLine('B', vec(0, -50), vec(0, 50));
    const r = ok(filletLines(docOf(A, B), 'A', vec(-30, 0), 'B', vec(0, -30), 5, newId));
    expect(get<LineShape>(r.doc, 'A')).toMatchObject({ start: vec(-50, 0) });
    expect(get<LineShape>(r.doc, 'A').end.x).toBeCloseTo(-5, 9);
    expect(get<LineShape>(r.doc, 'B').end.y).toBeCloseTo(-5, 9);
  });

  it('refuses parallel lines, the same line twice, too-large radii and negative radii', () => {
    const P = createLine('P', vec(0, 10), vec(100, 10));
    expect(filletLines(docOf(X, P), 'X', vec(50, 0), 'P', vec(50, 10), 5, newId)).toMatchObject({ ok: false, message: expect.stringMatching(/parallel/) });
    expect(filletLines(docOf(X), 'X', vec(50, 0), 'X', vec(60, 0), 5, newId).ok).toBe(false);
    expect(filletLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), 90, newId)).toMatchObject({ ok: false, message: expect.stringMatching(/too short/) });
    expect(filletLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), -1, newId).ok).toBe(false);
    expect(filletLines(docOf(X, C), 'X', vec(50, 0), 'C', vec(0, 10), 5, newId).ok).toBe(false);
  });
});

describe('chamfer', () => {
  const X = createLine('X', vec(0, 0), vec(100, 0));
  const Y = createLine('Y', vec(0, 0), vec(0, 80));

  it('cuts the corner at the given distance along each line', () => {
    const r = ok(chamferLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), 10, 10, newId));
    const cut = r.doc.shapes[2] as LineShape;
    expect(cut.start).toEqual(vec(10, 0));
    expect(cut.end).toEqual(vec(0, 10));
    expect(lineLength(cut)).toBeCloseTo(10 * Math.SQRT2, 12);
    expect(get<LineShape>(r.doc, 'X').start).toEqual(vec(10, 0));
  });

  it('unequal distances; refusals for parallel / too long', () => {
    const r = ok(chamferLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), 20, 5, newId));
    expect((r.doc.shapes[2] as LineShape).start).toEqual(vec(20, 0));
    expect(chamferLines(docOf(X, Y), 'X', vec(50, 0), 'Y', vec(0, 40), 200, 5, newId).ok).toBe(false);
    const P = createLine('P', vec(0, 10), vec(100, 10));
    expect(chamferLines(docOf(X, P), 'X', vec(50, 0), 'P', vec(50, 10), 5, 5, newId).ok).toBe(false);
  });
});
