import { describe, expect, it } from 'vitest';
import {
  circleCircleIntersection,
  intersectPrimitives,
  lineCircleParams,
  lineLineIntersection,
  mirrorPoint,
  nearestOnCircle,
  perpendicularFeet,
  segmentIntersection,
  tangentPoints,
} from '../src/geometry/intersect';
import { distance, vec, vecApproxEqual } from '../src/geometry/vec';

describe('intersections', () => {
  it('crossing segments intersect at the exact point', () => {
    const h = segmentIntersection(vec(0, 0), vec(10, 10), vec(0, 10), vec(10, 0))!;
    expect(h.point).toEqual(vec(5, 5));
    expect(h.t).toBeCloseTo(0.5, 12);
  });

  it('parallel and collinear lines have no single intersection', () => {
    expect(lineLineIntersection(vec(0, 0), vec(10, 0), vec(0, 5), vec(10, 5))).toBeNull();
    expect(lineLineIntersection(vec(0, 0), vec(10, 0), vec(20, 0), vec(30, 0))).toBeNull();
  });

  it('non-intersecting segments (lines would cross outside) → null', () => {
    expect(segmentIntersection(vec(0, 0), vec(1, 0), vec(5, -1), vec(5, 1))).toBeNull();
    expect(lineLineIntersection(vec(0, 0), vec(1, 0), vec(5, -1), vec(5, 1))!.point).toEqual(vec(5, 0));
  });

  it('zero-length segments never intersect', () => {
    expect(lineLineIntersection(vec(1, 1), vec(1, 1), vec(0, 0), vec(2, 2))).toBeNull();
  });

  it('line–circle: secant, tangent and miss', () => {
    expect(lineCircleParams(vec(-10, 0), vec(10, 0), vec(0, 0), 5)).toEqual([0.25, 0.75]);
    expect(lineCircleParams(vec(-10, 5), vec(10, 5), vec(0, 0), 5)).toEqual([0.5]);
    expect(lineCircleParams(vec(-10, 6), vec(10, 6), vec(0, 0), 5)).toEqual([]);
  });

  it('circle–circle: two points, tangent, separate, concentric', () => {
    const pts = circleCircleIntersection(vec(0, 0), 5, vec(8, 0), 5);
    expect(pts).toHaveLength(2);
    pts.forEach((p) => expect(p.x).toBeCloseTo(4, 12));
    expect(circleCircleIntersection(vec(0, 0), 5, vec(10, 0), 5)).toEqual([vec(5, 0)]);
    expect(circleCircleIntersection(vec(0, 0), 5, vec(20, 0), 5)).toEqual([]);
    expect(circleCircleIntersection(vec(0, 0), 5, vec(0, 0), 3)).toEqual([]);
  });

  it('segment–circle only returns points on the segment', () => {
    const pts = intersectPrimitives({ type: 'seg', a: vec(0, 0), b: vec(10, 0) }, { type: 'circle', c: vec(0, 0), r: 5 });
    expect(pts).toEqual([vec(5, 0)]);
  });

  it('perpendicular foot on a segment and on a circle', () => {
    expect(perpendicularFeet(vec(3, 7), { type: 'seg', a: vec(0, 0), b: vec(10, 0) })).toEqual([vec(3, 0)]);
    expect(perpendicularFeet(vec(30, 7), { type: 'seg', a: vec(0, 0), b: vec(10, 0) })).toEqual([]);
    const f = perpendicularFeet(vec(20, 0), { type: 'circle', c: vec(0, 0), r: 5 });
    expect(f[0]).toEqual(vec(5, 0));
  });

  it('tangent points from an external point are tangent (radius ⟂ tangent line)', () => {
    const base = vec(10, 0);
    const pts = tangentPoints(base, vec(0, 0), 5);
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(distance(p, vec(0, 0))).toBeCloseTo(5, 12);
      const dotp = p.x * (base.x - p.x) + p.y * (base.y - p.y);
      expect(dotp).toBeCloseTo(0, 9);
    }
    expect(tangentPoints(vec(1, 0), vec(0, 0), 5)).toEqual([]);
  });

  it('nearest point on circle and mirror reflection', () => {
    expect(vecApproxEqual(nearestOnCircle(vec(0, 20), vec(0, 0), 5), vec(0, 5))).toBe(true);
    expect(vecApproxEqual(mirrorPoint(vec(3, 4), vec(0, 0), vec(1, 0)), vec(3, -4))).toBe(true);
    expect(vecApproxEqual(mirrorPoint(vec(1, 0), vec(0, 0), vec(1, 1)), vec(0, 1))).toBe(true);
    expect(() => mirrorPoint(vec(1, 0), vec(2, 2), vec(2, 2))).toThrow(RangeError);
  });
});
