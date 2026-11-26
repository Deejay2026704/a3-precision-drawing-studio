import { describe, expect, it } from 'vitest';
import { distance, vec } from '../src/geometry/vec';
import { arcEnd, arcStart } from '../src/model/arcs';
import { createEmptyDocument } from '../src/model/document';
import { filletAny } from '../src/model/filletCurves';
import { createArc, createCircle, createLine } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type ArcShape, type DrawingDocument, type LineShape, type Shape } from '../src/model/types';
import { newSession, toolClick } from '../src/ui/interaction/toolSession';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { message: string }).message);
  return r as Extract<T, { ok: true }>;
};
const get = <S extends Shape>(d: DrawingDocument, id: string) => d.shapes.find((s) => s.id === id) as S;
const last = (d: DrawingDocument) => d.shapes[d.shapes.length - 1] as ArcShape;
const near = (a: number, b: number, digits = 9) => expect(a).toBeCloseTo(b, digits);
const r180 = Math.sqrt(180);

// Line y = 0 and a circle r10 at (0, 20): an R8 fillet centre is 8 above the line and 18 from the circle centre.
const L = createLine('L', vec(-50, 0), vec(50, 0));
const C = createCircle('C', vec(0, 20), 10);

describe('fillet with circles and arcs', () => {
  it('line – circle: exact centre and tangent points; line trimmed, circle left whole', () => {
    const r = ok(filletAny(docOf(L, C), 'L', vec(30, 0), 'C', vec(10, 20), 8, () => 'F'));
    const f = last(r.doc);
    near(f.center.x, r180);
    near(f.center.y, 8);
    expect(f.radius).toBe(8);
    near(distance(f.center, vec(0, 20)), 18); // externally tangent to the circle
    const l = get<LineShape>(r.doc, 'L');
    near(l.start.x, r180);
    expect(l.end).toEqual(vec(50, 0));
    expect(get(r.doc, 'C')).toEqual(C);
    // the fillet arc's ends are the tangent points
    const ends = [arcStart(f), arcEnd(f)];
    expect(ends.some((p) => distance(p, vec(r180, 0)) < 1e-9)).toBe(true);
    expect(ends.some((p) => Math.abs(distance(p, vec(0, 20)) - 10) < 1e-9)).toBe(true);
  });
  it('the picks choose the side: picking left gives the mirror-image fillet', () => {
    const f = last(ok(filletAny(docOf(L, C), 'L', vec(-30, 0), 'C', vec(-10, 20), 8, () => 'F')).doc);
    near(f.center.x, -r180);
  });
  it('line – arc: the arc is trimmed at the tangent point, keeping the picked part', () => {
    const A = createArc('A', vec(0, 20), 10, 180, 180); // bottom half
    const r = ok(filletAny(docOf(L, A), 'L', vec(30, 0), 'A', vec(0, 10), 8, () => 'F'));
    const a = get<ArcShape>(r.doc, 'A');
    expect(a.startDeg).toBe(180);
    const tDeg = (Math.atan2(8 - 20, r180) * 180) / Math.PI + 360; // tangent point direction from the arc centre
    near(a.startDeg + a.sweepDeg, tDeg);
  });
  it('circle – circle: fillet R15 between two r10 circles 40 apart', () => {
    const c1 = createCircle('c1', vec(0, 0), 10);
    const c2 = createCircle('c2', vec(40, 0), 10);
    const f = last(ok(filletAny(docOf(c1, c2), 'c1', vec(8, 6), 'c2', vec(32, 6), 15, () => 'F')).doc);
    near(f.center.x, 20);
    near(f.center.y, 15);
    const ends = [arcStart(f), arcEnd(f)].sort((p, q) => p.x - q.x);
    near(ends[0].x, 8);
    near(ends[0].y, 6);
    near(ends[1].x, 32);
    near(f.sweepDeg, 106.2602047, 6);
  });
  it('refusals: no room for the radius; radius 0 with a curve; same object', () => {
    const far1 = createCircle('a', vec(0, 0), 1);
    const far2 = createCircle('b', vec(100, 0), 1);
    expect(filletAny(docOf(far1, far2), 'a', vec(1, 0), 'b', vec(99, 0), 10, () => 'F').ok).toBe(false);
    expect(filletAny(docOf(L, C), 'L', vec(30, 0), 'C', vec(10, 20), 0, () => 'F').ok).toBe(false);
    expect(filletAny(docOf(C), 'C', vec(10, 20), 'C', vec(-10, 20), 5, () => 'F').ok).toBe(false);
  });
  it('two lines still use the line fillet (radius 0 = sharp corner allowed)', () => {
    const a = createLine('a', vec(0, 0), vec(10, 0));
    const b = createLine('b', vec(12, 2), vec(12, 10));
    const r = ok(filletAny(docOf(a, b), 'a', vec(5, 0), 'b', vec(12, 8), 0, () => 'F'));
    expect(get<LineShape>(r.doc, 'a').end).toEqual(vec(12, 0));
  });
  it('the Fillet tool accepts a line then a circle', () => {
    const base = { doc: docOf(L, C), selection: [], snap: null, tolerance: 1, dimStyle: DEFAULT_DIMENSION_STYLE, offsetDistanceMm: 5, mirrorKeepSource: true, newId: () => 'F', filletRadiusMm: 8 };
    const s = toolClick(newSession('fillet'), { ...base, raw: vec(30, 0), point: vec(30, 0) }).session;
    const step = toolClick(s, { ...base, raw: vec(10, 20), point: vec(10, 20) });
    expect(step.kind).toBe('commit');
  });
});
