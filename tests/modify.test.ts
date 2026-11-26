import { describe, expect, it } from 'vitest';
import { distance, vec, vecApproxEqual } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { extendLine, mirrorShape, mirrorShapes, offsetShape, trimLine } from '../src/model/modify';
import { createCircle, createLine, createPolyline, createRect, lineLength, rectCorners, shapeBounds } from '../src/model/shapes';
import { measureDimension } from '../src/model/dimensions';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument, type LineShape, type Shape } from '../src/model/types';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
let n = 0;
const newId = () => `new${++n}`;
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(`expected ok: ${(r as unknown as { message: string }).message}`);
  return r as Extract<T, { ok: true }>;
};
const line = (doc: DrawingDocument, id: string) => doc.shapes.find((s) => s.id === id) as LineShape;

describe('trim', () => {
  const base = createLine('L', vec(0, 0), vec(100, 0));
  const c1 = createLine('A', vec(30, -10), vec(30, 10));
  const c2 = createLine('B', vec(70, -10), vec(70, 10));

  it('removes the end portion beyond the cutting edge', () => {
    const r = ok(trimLine(docOf(base, c1), 'L', vec(80, 0), newId));
    expect(line(r.doc, 'L')).toMatchObject({ start: vec(0, 0), end: vec(30, 0) });
  });

  it('removes the start portion', () => {
    const r = ok(trimLine(docOf(base, c1), 'L', vec(10, 0), newId));
    expect(line(r.doc, 'L')).toMatchObject({ start: vec(30, 0), end: vec(100, 0) });
  });

  it('splits the line when the middle portion is picked; linked dimensions follow the original end', () => {
    const dim = { id: 'D', kind: 'aligned', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, offset: 10, p1: { kind: 'shape', shapeId: 'L', key: 'start' }, p2: { kind: 'shape', shapeId: 'L', key: 'end' } } as const;
    const doc = { ...docOf(base, c1, c2), dimensions: [dim] };
    const r = ok(trimLine(doc, 'L', vec(50, 0), newId));
    const lines = r.doc.shapes.filter((s) => s.kind === 'line' && s.start.y === 0 && s.end.y === 0) as LineShape[];
    expect(lines).toHaveLength(2);
    expect(line(r.doc, 'L')).toMatchObject({ start: vec(0, 0), end: vec(30, 0) });
    const second = lines.find((l) => l.id !== 'L')!;
    expect(second).toMatchObject({ start: vec(70, 0), end: vec(100, 0) });
    // the overall dimension still spans 0..100 (start of first piece → end of second piece)
    expect(measureDimension(r.doc, r.doc.dimensions[0])).toBeCloseTo(100, 12);
  });

  it('trims against circles', () => {
    const r = ok(trimLine(docOf(base, createCircle('C', vec(50, 0), 10)), 'L', vec(50, 0), newId));
    expect(r.doc.shapes.filter((s) => s.kind === 'line')).toHaveLength(2);
    expect(line(r.doc, 'L').end.x).toBeCloseTo(40, 12);
  });

  it('refuses when nothing crosses the line (non-intersecting / parallel) – geometry untouched', () => {
    const parallel = createLine('P', vec(0, 5), vec(100, 5));
    const doc = docOf(base, parallel, createLine('F', vec(200, -5), vec(200, 5)));
    const r = trimLine(doc, 'L', vec(50, 0), newId);
    expect(r.ok).toBe(false);
    expect(doc.shapes).toHaveLength(3);
  });

  it('refuses unsupported and zero-length geometry', () => {
    expect(trimLine(docOf(createCircle('C', vec(0, 0), 5), base), 'C', vec(5, 0), newId).ok).toBe(false);
    expect(trimLine(docOf(createLine('Z', vec(1, 1), vec(1, 1)), c1), 'Z', vec(1, 1), newId).ok).toBe(false);
  });
});

describe('extend', () => {
  const l = createLine('L', vec(0, 0), vec(10, 0));
  const wall = createLine('W', vec(50, -10), vec(50, 10));

  it('extends the nearer end to the boundary', () => {
    const r = ok(extendLine(docOf(l, wall), 'L', vec(9, 0)));
    expect(line(r.doc, 'L').end).toEqual(vec(50, 0));
    expect(line(r.doc, 'L').start).toEqual(vec(0, 0));
  });

  it('extends the start end backwards', () => {
    const r = ok(extendLine(docOf(l, createLine('W2', vec(-20, -5), vec(-20, 5))), 'L', vec(1, 0)));
    expect(line(r.doc, 'L').start).toEqual(vec(-20, 0));
  });

  it('extends to the nearest of several boundaries, including circles', () => {
    const r = ok(extendLine(docOf(l, wall, createCircle('C', vec(30, 0), 5)), 'L', vec(9, 0)));
    expect(line(r.doc, 'L').end.x).toBeCloseTo(25, 12);
  });

  it('refuses when the boundary is parallel or not in the line’s path', () => {
    expect(extendLine(docOf(l, createLine('P', vec(0, 5), vec(100, 5))), 'L', vec(9, 0)).ok).toBe(false);
    expect(extendLine(docOf(l, createLine('M', vec(50, 5), vec(50, 20))), 'L', vec(9, 0)).ok).toBe(false);
  });

  it('refuses zero-length lines', () => {
    expect(extendLine(docOf(createLine('Z', vec(0, 0), vec(0, 0)), wall), 'Z', vec(0, 0)).ok).toBe(false);
  });
});

describe('offset', () => {
  it('offsets a line to the picked side by the exact distance', () => {
    const l = createLine('L', vec(0, 0), vec(100, 0));
    const up = ok(offsetShape(docOf(l), 'L', 12.5, vec(50, 3), newId));
    expect(up.doc.shapes[1]).toMatchObject({ start: vec(0, 12.5), end: vec(100, 12.5) });
    const down = ok(offsetShape(docOf(l), 'L', 12.5, vec(50, -3), newId));
    expect(down.doc.shapes[1]).toMatchObject({ start: vec(0, -12.5), end: vec(100, -12.5) });
    expect(up.doc.shapes[0]).toEqual(l); // original untouched
  });

  it('offsets circles outwards and inwards, refusing a non-positive radius', () => {
    const c = createCircle('C', vec(0, 0), 10);
    expect(ok(offsetShape(docOf(c), 'C', 5, vec(30, 0), newId)).doc.shapes[1]).toMatchObject({ radius: 15 });
    expect(ok(offsetShape(docOf(c), 'C', 5, vec(1, 0), newId)).doc.shapes[1]).toMatchObject({ radius: 5 });
    expect(offsetShape(docOf(c), 'C', 10, vec(1, 0), newId).ok).toBe(false);
  });

  it('offsets rotated rectangles in and out, keeping them concentric', () => {
    const r = createRect('R', vec(10, 10), 40, 20, 30);
    const out = ok(offsetShape(docOf(r), 'R', 2, vec(500, 500), newId)).doc.shapes[1] as typeof r;
    expect(out.width).toBeCloseTo(44, 12);
    expect(out.height).toBeCloseTo(24, 12);
    expect(out.rotationDeg).toBe(30);
    const c0 = rectCorners(r);
    const c1 = rectCorners(out);
    const ctr = (c: typeof c0) => vec((c[0].x + c[2].x) / 2, (c[0].y + c[2].y) / 2);
    expect(vecApproxEqual(ctr(c0), ctr(c1), 1e-9)).toBe(true);
    const inner = ok(offsetShape(docOf(r), 'R', 2, ctr(c0), newId)).doc.shapes[1] as typeof r;
    expect(inner.width).toBeCloseTo(36, 12);
    expect(offsetShape(docOf(r), 'R', 10, ctr(c0), newId).ok).toBe(false);
  });

  it('offsets an L-shaped polyline with a mitred corner', () => {
    const p = createPolyline('P', [vec(0, 0), vec(10, 0), vec(10, 10)]);
    const r = ok(offsetShape(docOf(p), 'P', 1, vec(5, 1), newId)).doc.shapes[1] as typeof p;
    expect(r.points).toHaveLength(3);
    expect(vecApproxEqual(r.points[1], vec(9, 1))).toBe(true);
  });

  it('rejects zero/negative distance, points on the line and zero-length geometry', () => {
    const l = createLine('L', vec(0, 0), vec(10, 0));
    expect(offsetShape(docOf(l), 'L', 0, vec(5, 5), newId).ok).toBe(false);
    expect(offsetShape(docOf(l), 'L', -3, vec(5, 5), newId).ok).toBe(false);
    expect(offsetShape(docOf(l), 'L', 3, vec(5, 0), newId).ok).toBe(false);
    expect(offsetShape(docOf(createLine('Z', vec(1, 1), vec(1, 1))), 'Z', 3, vec(5, 5), newId).ok).toBe(false);
    expect(offsetShape(docOf(createPolyline('Q', [vec(1, 1), vec(1, 1)])), 'Q', 3, vec(5, 5), newId).ok).toBe(false);
  });
});

describe('mirror', () => {
  it('mirrors lines, circles and polylines about an arbitrary axis', () => {
    const a = vec(0, 0);
    const b = vec(1, 1); // y = x
    expect(mirrorShape(createLine('l', vec(2, 0), vec(5, 1)), a, b)).toMatchObject({ start: vec(0, 2), end: vec(1, 5) });
    const c = mirrorShape(createCircle('c', vec(3, 0), 2), a, b);
    expect(vecApproxEqual(c.center, vec(0, 3))).toBe(true);
    expect(c.radius).toBe(2);
  });

  it('mirrors rotated rectangles into true rectangles with the same corner set', () => {
    const r = createRect('r', vec(10, 5), 30, 12, 25);
    const m = mirrorShape(r, vec(0, -3), vec(7, 40));
    expect(m.width).toBe(30);
    expect(m.height).toBe(12);
    const expected = rectCorners(r).map((p) => {
      const a = vec(0, -3);
      const d = vec(7, 43);
      const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y);
      return vec(2 * (a.x + d.x * t) - p.x, 2 * (a.y + d.y * t) - p.y);
    });
    for (const p of expected) expect(rectCorners(m).some((q) => distance(p, q) < 1e-9)).toBe(true);
  });

  it('keeps or replaces the source', () => {
    const l = createLine('L', vec(0, 1), vec(10, 1));
    const keep = ok(mirrorShapes(docOf(l), ['L'], vec(0, 0), vec(10, 0), true, newId));
    expect(keep.doc.shapes).toHaveLength(2);
    expect(keep.doc.shapes[0]).toEqual(l);
    const move = ok(mirrorShapes(docOf(l), ['L'], vec(0, 0), vec(10, 0), false, newId));
    expect(move.doc.shapes).toHaveLength(1);
    expect(move.doc.shapes[0]).toMatchObject({ id: 'L', start: vec(0, -1) });
    expect(lineLength(move.doc.shapes[0] as LineShape)).toBe(10);
  });

  it('refuses a zero-length axis or an empty selection', () => {
    const l = createLine('L', vec(0, 1), vec(10, 1));
    expect(mirrorShapes(docOf(l), ['L'], vec(3, 3), vec(3, 3), true, newId).ok).toBe(false);
    expect(mirrorShapes(docOf(l), [], vec(0, 0), vec(1, 0), true, newId).ok).toBe(false);
    expect(shapeBounds(l)).toEqual({ minX: 0, minY: 1, maxX: 10, maxY: 1 });
  });
});
