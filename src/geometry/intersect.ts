import { nearestOnArc, pointOnArc } from './arc';
import { add, distance, dot, EPSILON, length, mul, sub, vec, type Vec2 } from './vec';

/**
 * Exact (floating-point) intersection and projection routines used by snapping,
 * trim/extend and dimensions. All inputs and outputs are drawing millimetres.
 * Nothing here knows about screens or zoom.
 */

/** Relative tolerance used to decide parallelism / tangency. */
export const GEOM_TOL = 1e-9;

export type Primitive =
  | { readonly type: 'seg'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly type: 'circle'; readonly c: Vec2; readonly r: number }
  /** Arc of circle (c, r): CCW from startDeg through sweepDeg. */
  | { readonly type: 'arc'; readonly c: Vec2; readonly r: number; readonly startDeg: number; readonly sweepDeg: number };

/** Round primitives share circle maths; an arc additionally clips to its sweep. */
const onPrim = (q: Primitive, p: Vec2): boolean => q.type !== 'arc' || pointOnArc(q, p);
const asCircle = (q: Primitive) => q as { c: Vec2; r: number };

export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export interface LineHit {
  readonly point: Vec2;
  /** Parameter along the first line (0 at p1, 1 at p2). */
  readonly t: number;
  /** Parameter along the second line (0 at p3, 1 at p4). */
  readonly u: number;
}

/**
 * Intersection of the INFINITE lines p1–p2 and p3–p4.
 * Returns null if either line is degenerate or the lines are parallel (incl. collinear).
 */
export function lineLineIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): LineHit | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const lr = length(r);
  const ls = length(s);
  if (lr < EPSILON || ls < EPSILON) return null;
  const denom = cross(r, s);
  if (Math.abs(denom) <= GEOM_TOL * lr * ls) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  return { point: add(p1, mul(r, t)), t, u };
}

/** Intersection of two finite segments (endpoints included). Parallel/collinear → null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): LineHit | null {
  const hit = lineLineIntersection(a, b, c, d);
  if (!hit) return null;
  const tol = 1e-12;
  return hit.t >= -tol && hit.t <= 1 + tol && hit.u >= -tol && hit.u <= 1 + tol ? hit : null;
}

/**
 * Parameters t along the infinite line p1→p2 where it meets a circle.
 * A tangent line yields one parameter; a miss yields none.
 */
export function lineCircleParams(p1: Vec2, p2: Vec2, c: Vec2, r: number): number[] {
  const d = sub(p2, p1);
  const a = dot(d, d);
  if (a < EPSILON * EPSILON || r < 0) return [];
  const t0 = dot(sub(c, p1), d) / a;
  const foot = add(p1, mul(d, t0));
  const h = distance(foot, c);
  const tol = GEOM_TOL * Math.max(1, r);
  if (h > r + tol) return [];
  if (Math.abs(h - r) <= tol) return [t0];
  const half = Math.sqrt(r * r - h * h) / Math.sqrt(a);
  return [t0 - half, t0 + half];
}

/** Intersection points of two circles. Concentric (incl. identical) circles → none. */
export function circleCircleIntersection(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = distance(c1, c2);
  if (d < EPSILON) return [];
  const tol = GEOM_TOL * Math.max(1, r1, r2);
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const base = vec(c1.x + ux * a, c1.y + uy * a);
  if (h2 <= tol * tol || h2 <= 0) return [base];
  const h = Math.sqrt(h2);
  return [vec(base.x - uy * h, base.y + ux * h), vec(base.x + uy * h, base.y - ux * h)];
}

/** All intersection points of two primitives (segments and arcs are finite). */
export function intersectPrimitives(p: Primitive, q: Primitive): Vec2[] {
  if (p.type === 'seg' && q.type === 'seg') {
    const h = segmentIntersection(p.a, p.b, q.a, q.b);
    return h ? [h.point] : [];
  }
  if (p.type !== 'seg' && q.type !== 'seg') {
    return circleCircleIntersection(asCircle(p).c, asCircle(p).r, asCircle(q).c, asCircle(q).r).filter((x) => onPrim(p, x) && onPrim(q, x));
  }
  const seg = (p.type === 'seg' ? p : q) as Extract<Primitive, { type: 'seg' }>;
  const round = p.type === 'seg' ? q : p;
  return lineCircleParams(seg.a, seg.b, asCircle(round).c, asCircle(round).r)
    .filter((t) => t >= -1e-12 && t <= 1 + 1e-12)
    .map((t) => add(seg.a, mul(sub(seg.b, seg.a), t)))
    .filter((x) => onPrim(round, x));
}

/** Parameters t (along the infinite line p1→p2) of its intersections with a primitive. */
export function lineParamsWithPrimitive(p1: Vec2, p2: Vec2, q: Primitive): number[] {
  if (q.type === 'circle') return lineCircleParams(p1, p2, q.c, q.r);
  if (q.type === 'arc') return lineCircleParams(p1, p2, q.c, q.r).filter((t) => onPrim(q, add(p1, mul(sub(p2, p1), t))));
  const h = lineLineIntersection(p1, p2, q.a, q.b);
  return h && h.u >= -1e-12 && h.u <= 1 + 1e-12 ? [h.t] : [];
}

/** Closest point to p on the segment a–b. */
export function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < EPSILON * EPSILON) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return add(a, mul(ab, t));
}

/** Closest point to p on a circle (p at the centre → the 0° point). */
export function nearestOnCircle(p: Vec2, c: Vec2, r: number): Vec2 {
  const v = sub(p, c);
  const l = length(v);
  if (l < EPSILON) return vec(c.x + r, c.y);
  return add(c, mul(v, r / l));
}

export function nearestOnPrimitive(p: Vec2, q: Primitive): Vec2 {
  if (q.type === 'arc') return nearestOnArc(q, p);
  return q.type === 'seg' ? nearestOnSegment(p, q.a, q.b) : nearestOnCircle(p, q.c, q.r);
}

/**
 * Foot of the perpendicular from `base` to a primitive.
 * Segment: the projection, only if it falls within the segment.
 * Circle: the point where the radial line through `base` meets the circle,
 * choosing the one nearest `near` (both are perpendicular to the circle).
 */
export function perpendicularFeet(base: Vec2, q: Primitive): Vec2[] {
  if (q.type === 'seg') {
    const ab = sub(q.b, q.a);
    const len2 = dot(ab, ab);
    if (len2 < EPSILON * EPSILON) return [];
    const t = dot(sub(base, q.a), ab) / len2;
    return t >= -1e-12 && t <= 1 + 1e-12 ? [add(q.a, mul(ab, t))] : [];
  }
  const v = sub(base, q.c);
  const l = length(v);
  if (l < EPSILON) return [];
  const u = mul(v, 1 / l);
  return [add(q.c, mul(u, q.r)), sub(q.c, mul(u, q.r))].filter((x) => onPrim(q, x));
}

/** Tangent points on a circle as seen from an external point. Inside / on the circle → none. */
export function tangentPoints(base: Vec2, c: Vec2, r: number): Vec2[] {
  const v = sub(base, c);
  const d = length(v);
  if (r <= 0 || d <= r * (1 + GEOM_TOL)) return [];
  const theta = Math.atan2(v.y, v.x);
  const alpha = Math.acos(r / d);
  return [theta + alpha, theta - alpha].map((a) => vec(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
}

/** Reflect point p across the infinite line through a and b. */
export function mirrorPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 < EPSILON * EPSILON) throw new RangeError('Mirror line has zero length');
  const t = dot(sub(p, a), d) / len2;
  const foot = add(a, mul(d, t));
  return vec(2 * foot.x - p.x, 2 * foot.y - p.y);
}
