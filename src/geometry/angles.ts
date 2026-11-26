import { add, sub, vec, type Vec2 } from './vec';

/**
 * Angle convention for the whole application:
 * degrees, measured from the +X axis, counter-clockwise positive
 * (in the Y-up drawing coordinate system).
 */
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normalise an angle to the range [0, 360). */
export function normalizeAngle(deg: number): number {
  const r = deg % 360;
  const n = r < 0 ? r + 360 : r;
  // Avoid returning 360 because of floating-point rounding, and avoid -0.
  return Math.abs(n - 360) < 1e-9 || Math.abs(n) < 1e-12 ? 0 : n;
}

/** Direction of the vector from a to b, in degrees [0, 360). */
export function angleBetweenPoints(a: Vec2, b: Vec2): number {
  return normalizeAngle(radToDeg(Math.atan2(b.y - a.y, b.x - a.x)));
}

/** Rotate vector v about the origin by deg (CCW positive). */
export function rotateVec(v: Vec2, deg: number): Vec2 {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return vec(v.x * c - v.y * s, v.x * s + v.y * c);
}

/** Rotate point p about pivot by deg (CCW positive). */
export function rotatePoint(p: Vec2, pivot: Vec2, deg: number): Vec2 {
  return add(pivot, rotateVec(sub(p, pivot), deg));
}

/** Point at a given distance and direction from a start point. */
export function polarPoint(start: Vec2, lengthMm: number, deg: number): Vec2 {
  const r = degToRad(deg);
  return vec(start.x + lengthMm * Math.cos(r), start.y + lengthMm * Math.sin(r));
}

/** Snap an angle to the nearest multiple of step degrees. */
export function snapAngle(deg: number, step: number): number {
  return Math.round(deg / step) * step;
}
