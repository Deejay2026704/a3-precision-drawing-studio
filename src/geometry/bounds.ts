import { vec, type Vec2 } from './vec';

/** Axis-aligned bounding box in a Y-up coordinate system. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOfPoints(points: readonly Vec2[]): Bounds {
  if (points.length === 0) throw new Error('boundsOfPoints: no points');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(list: readonly Bounds[]): Bounds {
  if (list.length === 0) throw new Error('unionBounds: empty list');
  return {
    minX: Math.min(...list.map((b) => b.minX)),
    minY: Math.min(...list.map((b) => b.minY)),
    maxX: Math.max(...list.map((b) => b.maxX)),
    maxY: Math.max(...list.map((b) => b.maxY)),
  };
}

export const boundsWidth = (b: Bounds): number => b.maxX - b.minX;
export const boundsHeight = (b: Bounds): number => b.maxY - b.minY;
export const boundsCenter = (b: Bounds): Vec2 => vec((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);

/** True if inner lies completely inside outer. */
export const boundsContains = (outer: Bounds, inner: Bounds): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;

/** Bounds of a rectangle given by two arbitrary corners. */
export const boundsFromCorners = (a: Vec2, b: Vec2): Bounds => boundsOfPoints([a, b]);
