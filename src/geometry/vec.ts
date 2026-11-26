/** 2D vector / point in millimetres. Immutable by convention. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Geometric tolerance used for comparisons (mm). */
export const EPSILON = 1e-9;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const ORIGIN: Vec2 = vec(0, 0);

export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.y - b.y);
export const mul = (a: Vec2, s: number): Vec2 => vec(a.x * s, a.y * s);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const midpoint = (a: Vec2, b: Vec2): Vec2 => vec((a.x + b.x) / 2, (a.y + b.y) / 2);

export const approxEqual = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
export const vecApproxEqual = (a: Vec2, b: Vec2, tol = 1e-6): boolean =>
  approxEqual(a.x, b.x, tol) && approxEqual(a.y, b.y, tol);

/** Shortest distance from point p to the segment a–b. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq < EPSILON) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lenSq));
  return distance(p, add(a, mul(ab, t)));
}
