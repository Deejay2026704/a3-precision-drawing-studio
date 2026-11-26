import type { Primitive } from '../geometry/intersect';
import { midpoint, type Vec2 } from '../geometry/vec';
import { rectCenter, rectCorners } from './shapes';
import type { DimAnchor, DrawingDocument, Shape } from './types';

/**
 * Named, stable points on shapes. Used by object snaps and as the link targets
 * of associative dimensions (a dimension stores {shapeId, key}, never a copied coordinate).
 *
 *   line:     start, end, mid
 *   rect:     c0..c3 (corners, local order), m0..m3 (edge midpoints), center
 *   circle:   center
 *   polyline: v<i> (vertices), sm<i> (segment midpoints)
 */
export type KeyedPointKind = 'endpoint' | 'midpoint' | 'center';

export interface KeyedPoint {
  readonly key: string;
  readonly kind: KeyedPointKind;
  readonly point: Vec2;
}

export function shapeKeyPoints(s: Shape): KeyedPoint[] {
  switch (s.kind) {
    case 'line':
      return [
        { key: 'start', kind: 'endpoint', point: s.start },
        { key: 'end', kind: 'endpoint', point: s.end },
        { key: 'mid', kind: 'midpoint', point: midpoint(s.start, s.end) },
      ];
    case 'rect': {
      const c = rectCorners(s);
      return [
        ...c.map((p, i) => ({ key: `c${i}`, kind: 'endpoint' as const, point: p })),
        ...c.map((p, i) => ({ key: `m${i}`, kind: 'midpoint' as const, point: midpoint(p, c[(i + 1) % 4]) })),
        { key: 'center', kind: 'center', point: rectCenter(s) },
      ];
    }
    case 'circle':
      return [{ key: 'center', kind: 'center', point: s.center }];
    case 'polyline':
      return [
        ...s.points.map((p, i) => ({ key: `v${i}`, kind: 'endpoint' as const, point: p })),
        ...s.points.slice(1).map((p, i) => ({ key: `sm${i}`, kind: 'midpoint' as const, point: midpoint(s.points[i], p) })),
      ];
  }
}

export function resolveShapeKey(s: Shape, key: string): Vec2 | null {
  return shapeKeyPoints(s).find((k) => k.key === key)?.point ?? null;
}

/** Current coordinates of a dimension anchor, or null if the linked shape/point no longer exists. */
export function resolveAnchor(doc: Pick<DrawingDocument, 'shapes'>, a: DimAnchor): Vec2 | null {
  if (a.kind === 'point') return a.point;
  const s = doc.shapes.find((x) => x.id === a.shapeId);
  return s ? resolveShapeKey(s, a.key) : null;
}

/** Decompose a shape into segments and circles for intersection / projection work. */
export function shapePrimitives(s: Shape): Primitive[] {
  const segs = (pts: readonly Vec2[], closed: boolean): Primitive[] => {
    const out: Primitive[] = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) out.push({ type: 'seg', a: pts[i], b: pts[(i + 1) % n] });
    return out;
  };
  switch (s.kind) {
    case 'line':
      return [{ type: 'seg', a: s.start, b: s.end }];
    case 'rect':
      return segs(rectCorners(s), true);
    case 'circle':
      return [{ type: 'circle', c: s.center, r: s.radius }];
    case 'polyline':
      return segs(s.points, false);
  }
}
