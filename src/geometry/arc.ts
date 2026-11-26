import { normalizeAngle } from './angles';
import { distance, vec, type Vec2 } from './vec';

/**
 * Circular arc helpers. An arc is the part of the circle (c, r) swept COUNTER-CLOCKWISE
 * from startDeg through sweepDeg degrees (0 < sweep < 360), in the Y-up drawing system.
 */
export interface ArcGeom {
  readonly c: Vec2;
  readonly r: number;
  readonly startDeg: number;
  readonly sweepDeg: number;
}

const ANG_EPS = 1e-9;
export const pointOnCircle = (c: Vec2, r: number, deg: number): Vec2 =>
  vec(c.x + r * Math.cos((deg * Math.PI) / 180), c.y + r * Math.sin((deg * Math.PI) / 180));

export const arcStartPoint = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.startDeg);
export const arcEndPoint = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.startDeg + a.sweepDeg);
export const arcMidPoint = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.startDeg + a.sweepDeg / 2);
export const arcLength = (a: ArcGeom) => (a.r * a.sweepDeg * Math.PI) / 180;

/** Angle (deg) of p as seen from the centre. */
export const angleAt = (c: Vec2, p: Vec2): number => normalizeAngle((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI);

/** True if the direction `deg` lies on the arc (endpoints included). */
export function angleOnArc(a: ArcGeom, deg: number): boolean {
  const rel = normalizeAngle(deg - a.startDeg);
  return rel <= a.sweepDeg + ANG_EPS || rel >= 360 - ANG_EPS;
}

/** True if p (assumed on the circle) lies on the arc. */
export const pointOnArc = (a: ArcGeom, p: Vec2): boolean => angleOnArc(a, angleAt(a.c, p));

export function distanceToArc(a: ArcGeom, p: Vec2): number {
  if (distance(p, a.c) > 0 && pointOnArc(a, p)) return Math.abs(distance(p, a.c) - a.r);
  return Math.min(distance(p, arcStartPoint(a)), distance(p, arcEndPoint(a)));
}

export function nearestOnArc(a: ArcGeom, p: Vec2): Vec2 {
  if (distance(p, a.c) > 1e-12 && pointOnArc(a, p)) return pointOnCircle(a.c, a.r, angleAt(a.c, p));
  const s = arcStartPoint(a);
  const e = arcEndPoint(a);
  return distance(p, s) <= distance(p, e) ? s : e;
}

/** Axis-aligned bounds: endpoints plus every axis extreme (0/90/180/270°) inside the sweep. */
export function arcBoundsPoints(a: ArcGeom): Vec2[] {
  const pts = [arcStartPoint(a), arcEndPoint(a)];
  for (const d of [0, 90, 180, 270]) if (angleOnArc(a, d)) pts.push(pointOnCircle(a.c, a.r, d));
  return pts;
}

/**
 * The arc from p1 to p3 passing through p2. Null if the points are collinear or coincide
 * (no unique circle).
 */
export function arcThroughPoints(p1: Vec2, p2: Vec2, p3: Vec2): ArcGeom | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  const scale = Math.max(distance(p1, p2), distance(p2, p3), distance(p1, p3), 1e-12);
  if (Math.abs(d) < 1e-12 * scale * scale) return null;
  const s1 = p1.x * p1.x + p1.y * p1.y;
  const s2 = p2.x * p2.x + p2.y * p2.y;
  const s3 = p3.x * p3.x + p3.y * p3.y;
  const c = vec((s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d, (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d);
  const r = distance(c, p1);
  const a1 = angleAt(c, p1);
  const a2 = angleAt(c, p2);
  const a3 = angleAt(c, p3);
  const ccwTo3 = normalizeAngle(a3 - a1);
  const ccwTo2 = normalizeAngle(a2 - a1);
  // p2 between p1 and p3 going CCW → CCW arc from p1; otherwise the CCW arc from p3.
  return ccwTo2 <= ccwTo3 ? { c, r, startDeg: a1, sweepDeg: ccwTo3 } : { c, r, startDeg: a3, sweepDeg: 360 - ccwTo3 };
}
