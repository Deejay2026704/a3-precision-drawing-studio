import { arcBoundsPoints as boundsPts, arcEndPoint, arcMidPoint, arcStartPoint, type ArcGeom } from '../geometry/arc';
import { normalizeAngle } from '../geometry/angles';
import type { ArcShape } from './types';

/** Arc shape ↔ geometry helpers (model layer). */
export const arcGeom = (a: ArcShape): ArcGeom => ({ c: a.center, r: a.radius, startDeg: a.startDeg, sweepDeg: a.sweepDeg });
export const arcBoundsPoints = (a: ArcShape) => boundsPts(arcGeom(a));
export const arcStart = (a: ArcShape) => arcStartPoint(arcGeom(a));
export const arcEnd = (a: ArcShape) => arcEndPoint(arcGeom(a));
export const arcMid = (a: ArcShape) => arcMidPoint(arcGeom(a));

/** Keep startDeg in [0, 360) and avoid -0. */
export function normalizeArc<A extends ArcShape>(a: A): A {
  const s = normalizeAngle(a.startDeg);
  return s === a.startDeg ? a : { ...a, startDeg: s };
}
