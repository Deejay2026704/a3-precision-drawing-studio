import { describe, expect, it } from 'vitest';
import { angleOnArc, arcThroughPoints, distanceToArc } from '../src/geometry/arc';
import { intersectPrimitives, lineParamsWithPrimitive } from '../src/geometry/intersect';
import { distance, vec, vecApproxEqual } from '../src/geometry/vec';
import { shapeKeyPoints } from '../src/model/anchors';
import { arcEnd, arcMid, arcStart } from '../src/model/arcs';
import { createRadialDimension, measureDimension } from '../src/model/dimensions';
import { createEmptyDocument } from '../src/model/document';
import { applyHandleDrag, getSelectionFrame } from '../src/model/handles';
import { distanceToShape } from '../src/model/hitTest';
import { mirrorShape, offsetShape } from '../src/model/modify';
import { moveShape, rotateShape, scaleShape } from '../src/model/operations';
import { createArc, createLine, shapeBounds } from '../src/model/shapes';
import { DEFAULT_SNAP_SETTINGS, findSnap } from '../src/model/snap';
import { DEFAULT_DIMENSION_STYLE, type ArcShape, type DrawingDocument } from '../src/model/types';
import { drawingPrimitives } from '../src/storage/drawingPrimitives';
import { parseProject, serializeProject } from '../src/storage/documentStorage';
import { exportSvg } from '../src/storage/exportSvg';
import { newSession, toolClick, toolPreview } from '../src/ui/interaction/toolSession';

// Quarter arc: centre (0,0), r = 10, from 0° to 90°.
const Q = createArc('Q', vec(0, 0), 10, 0, 90);
const docOf = (...shapes: DrawingDocument['shapes'][number][]): DrawingDocument => ({ ...createEmptyDocument(), shapes });

describe('arc geometry', () => {
  it('three points define the arc through them, in order', () => {
    const g = arcThroughPoints(vec(10, 0), vec(0, 10), vec(-10, 0))!;
    expect(vecApproxEqual(g.c, vec(0, 0))).toBe(true);
    expect(g.r).toBeCloseTo(10, 12);
    expect(g.startDeg).toBeCloseTo(0, 9);
    expect(g.sweepDeg).toBeCloseTo(180, 9);
    // the other way round (clockwise order) gives the same arc, stored CCW
    const h = arcThroughPoints(vec(-10, 0), vec(0, 10), vec(10, 0))!;
    expect(h.startDeg).toBeCloseTo(0, 9);
    expect(h.sweepDeg).toBeCloseTo(180, 9);
    // through the bottom instead
    const k = arcThroughPoints(vec(10, 0), vec(0, -10), vec(-10, 0))!;
    expect(k.startDeg).toBeCloseTo(180, 9);
    expect(k.sweepDeg).toBeCloseTo(180, 9);
  });

  it('collinear or coincident points have no arc', () => {
    expect(arcThroughPoints(vec(0, 0), vec(1, 1), vec(2, 2))).toBeNull();
    expect(arcThroughPoints(vec(0, 0), vec(0, 0), vec(2, 2))).toBeNull();
  });

  it('angle tests handle wrap-around at 360°', () => {
    const wrap = { c: vec(0, 0), r: 1, startDeg: 300, sweepDeg: 120 }; // 300° → 60°
    expect(angleOnArc(wrap, 0)).toBe(true);
    expect(angleOnArc(wrap, 59)).toBe(true);
    expect(angleOnArc(wrap, 180)).toBe(false);
  });

  it('bounds include only the axis extremes inside the sweep', () => {
    expect(shapeBounds(Q)).toEqual({ minX: expect.closeTo(0, 9), minY: 0, maxX: 10, maxY: 10 });
    const big = createArc('B', vec(0, 0), 10, 45, 270);
    const b = shapeBounds(big);
    expect(b.minX).toBeCloseTo(-10, 12);
    expect(b.maxY).toBeCloseTo(10, 12);
    expect(b.minY).toBeCloseTo(-10, 12);
    expect(b.maxX).toBeCloseTo(10 * Math.cos(Math.PI / 4), 12);
  });

  it('distance to the arc: on-arc points vs. beyond the ends', () => {
    expect(distanceToShape(Q, vec(0, 12))).toBeCloseTo(2, 12);
    expect(distanceToArc({ c: Q.center, r: 10, startDeg: 0, sweepDeg: 90 }, vec(0, -5))).toBeCloseTo(Math.hypot(10, 5), 12);
  });

  it('intersections are clipped to the arc', () => {
    const arc = { type: 'arc' as const, c: vec(0, 0), r: 10, startDeg: 0, sweepDeg: 90 };
    expect(intersectPrimitives(arc, { type: 'seg', a: vec(-20, 5), b: vec(20, 5) })).toHaveLength(1); // only the +x hit
    expect(intersectPrimitives(arc, { type: 'seg', a: vec(-20, -5), b: vec(20, -5) })).toEqual([]);
    expect(lineParamsWithPrimitive(vec(-20, 5), vec(20, 5), arc)).toHaveLength(1);
  });
});

describe('arc as a drawing object', () => {
  it('key points: ends, midpoint, centre', () => {
    const kp = Object.fromEntries(shapeKeyPoints(Q).map((k) => [k.key, k.point]));
    expect(vecApproxEqual(kp.start, vec(10, 0))).toBe(true);
    expect(vecApproxEqual(kp.end, vec(0, 10))).toBe(true);
    expect(vecApproxEqual(kp.mid, vec(10 * Math.SQRT1_2, 10 * Math.SQRT1_2))).toBe(true);
    expect(kp.center).toEqual(vec(0, 0));
  });

  it('move, rotate and uniform scale keep it an exact arc', () => {
    expect(moveShape(Q, 5, 5)).toMatchObject({ center: vec(5, 5), radius: 10, startDeg: 0, sweepDeg: 90 });
    const r = rotateShape(Q, 90, vec(0, 0));
    expect(r.startDeg).toBeCloseTo(90, 9);
    expect(vecApproxEqual(arcEnd(r), vec(-10, 0))).toBe(true);
    const s = scaleShape(Q, 2, 2, vec(0, 0));
    expect(s.radius).toBe(20);
    expect(vecApproxEqual(arcStart(s), vec(20, 0))).toBe(true);
  });

  it('mirror reverses orientation but keeps the same point set', () => {
    const m = mirrorShape(Q, vec(0, 0), vec(0, 1)); // mirror in the Y axis
    expect(m.sweepDeg).toBe(90);
    expect(vecApproxEqual(arcStart(m), vec(0, 10))).toBe(true);
    expect(vecApproxEqual(arcEnd(m), vec(-10, 0))).toBe(true);
  });

  it('offset outwards / inwards; too far inside is refused', () => {
    const out = offsetShape(docOf(Q), 'Q', 5, vec(20, 20), () => 'n1');
    expect(out.ok && (out.doc.shapes[1] as ArcShape).radius).toBe(15);
    const inn = offsetShape(docOf(Q), 'Q', 5, vec(2, 2), () => 'n2');
    expect(inn.ok && (inn.doc.shapes[1] as ArcShape).radius).toBe(5);
    expect(offsetShape(docOf(Q), 'Q', 12, vec(2, 2), () => 'n3').ok).toBe(false);
  });

  it('grips: end along the circle, radius, start keeps the end fixed', () => {
    const f = getSelectionFrame([Q], 5)!;
    expect(f.handles.map((h) => h.id)).toEqual(expect.arrayContaining(['start', 'end', 'radius', 'move']));
    const [e] = applyHandleDrag([Q], f, 'end', arcEnd(Q), vec(-30, 0)) as ArcShape[];
    expect(e.sweepDeg).toBeCloseTo(180, 9);
    const [r] = applyHandleDrag([Q], f, 'radius', arcMid(Q), vec(0, 25)) as ArcShape[];
    expect(r.radius).toBeCloseTo(25, 12);
    const [st] = applyHandleDrag([Q], f, 'start', arcStart(Q), vec(10, -10)) as ArcShape[];
    expect(st.startDeg).toBeCloseTo(315, 9);
    expect(vecApproxEqual(arcEnd(st), arcEnd(Q))).toBe(true);
  });

  it('snaps: endpoint, midpoint, centre, tangent and intersection on arcs', () => {
    const t = { shapes: [Q], tolerance: 1 };
    expect(findSnap(vec(10.3, 0.2), DEFAULT_SNAP_SETTINGS, t)!.point).toEqual(arcStart(Q));
    expect(findSnap(arcMid(Q), DEFAULT_SNAP_SETTINGS, t)!.kind).toBe('midpoint');
    expect(findSnap(vec(0.2, 0.1), DEFAULT_SNAP_SETTINGS, t)!.kind).toBe('center');
    // From (30, 0) the tangent points are at ±70.53°; only +70.53° lies on the 0–90° arc.
    const base = vec(30, 0);
    const a = Math.acos(1 / 3);
    const tg = findSnap(vec(10 * Math.cos(a) + 0.3, 10 * Math.sin(a) - 0.2), DEFAULT_SNAP_SETTINGS, { ...t, basePoint: base });
    expect(tg?.kind).toBe('tangent');
    expect(distance(tg!.point, vec(0, 0))).toBeCloseTo(10, 9);
    const v = vec(tg!.point.x - 30, tg!.point.y);
    expect(v.x * tg!.point.x + v.y * tg!.point.y).toBeCloseTo(0, 6); // radius ⟂ tangent line
    // From (20, 20) both tangent points miss the quarter arc: no tangent snap is offered.
    expect(findSnap(vec(-4.1, 9.1), { ...DEFAULT_SNAP_SETTINGS, gridSnap: false }, { ...t, basePoint: vec(20, 20), tolerance: 3 })?.kind).not.toBe('tangent');
    const L = createLine('L', vec(-20, 5), vec(20, 5));
    const ix = findSnap(vec(8.5, 5.2), DEFAULT_SNAP_SETTINGS, { shapes: [Q, L], tolerance: 1 })!;
    expect(ix.kind).toBe('intersection');
    expect(ix.point.x).toBeCloseTo(Math.sqrt(75), 9);
  });

  it('radius and diameter dimensions work on arcs and follow edits', () => {
    const d = docOf(Q);
    const r = createRadialDimension(d, 'D', 'radius', 'Q', vec(-5, -50), DEFAULT_DIMENSION_STYLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(measureDimension(d, r.value)).toBe(10);
    expect(r.value.angleDeg).toBeCloseTo(45, 9); // pick outside the sweep → arc midpoint direction
    expect(measureDimension({ shapes: [{ ...Q, radius: 12.5 }] }, r.value)).toBe(12.5);
  });

  it('three-click arc tool with preview; collinear points refused', () => {
    const base = { doc: createEmptyDocument(), selection: [], snap: null, tolerance: 1, dimStyle: DEFAULT_DIMENSION_STYLE, offsetDistanceMm: 5, mirrorKeepSource: true, newId: () => 'A1' };
    let s = newSession('arc');
    for (const p of [vec(10, 0), vec(0, 10)]) {
      const step = toolClick(s, { ...base, raw: p, point: p });
      expect(step.kind).toBe('continue');
      s = step.session;
    }
    const pv = toolPreview(s, { ...base, raw: vec(-10, 0), point: vec(-10, 0) });
    expect(pv.shapes[0]).toMatchObject({ kind: 'arc' });
    expect(toolClick(s, { ...base, raw: vec(20, -10), point: vec(20, -10) }).kind).toBe('error'); // collinear with the first two
    const done = toolClick(s, { ...base, raw: vec(-10, 0), point: vec(-10, 0) });
    expect(done.kind).toBe('commit');
    if (done.kind === 'commit') expect(done.doc.shapes[0]).toMatchObject({ kind: 'arc', radius: expect.closeTo(10, 9), sweepDeg: expect.closeTo(180, 9) });
  });
});

describe('arcs in files and exports', () => {
  it('round-trip in format v4; invalid sweeps rejected', () => {
    const d = docOf({ ...Q, layerId: 'layer-0' });
    expect(parseProject(serializeProject(d)).doc).toEqual(d);
    const bad = JSON.parse(serializeProject(d));
    bad.shapes[0].sweepDeg = 360;
    expect(() => parseProject(JSON.stringify(bad))).toThrow('shapes[0].sweepDeg');
    bad.shapes[0].sweepDeg = 0;
    expect(() => parseProject(JSON.stringify(bad))).toThrow('shapes[0].sweepDeg');
  });

  it('exported as a true arc (SVG path / PDF curves)', () => {
    const d = docOf({ ...Q, center: vec(100, 100), layerId: 'layer-0' });
    expect(drawingPrimitives(d)[0].items[0].prims[0]).toMatchObject({ kind: 'arc', r: 10, startDeg: 0, sweepDeg: 90 });
    expect(exportSvg(d)).toMatch(/<path fill="none" stroke="#000000" stroke-width="0.35" d="M 110 197 A 10 10 0 0 0 100 187"\/>/);
  });
});
