import {
  intersectPrimitives,
  nearestOnPrimitive,
  perpendicularFeet,
  tangentPoints,
  type Primitive,
} from '../geometry/intersect';
import { snapValue } from '../geometry/units';
import { pointOnArc } from '../geometry/arc';
import { distance, vec, type Vec2 } from '../geometry/vec';
import { shapeKeyPoints, shapePrimitives } from './anchors';
import { distanceToShape } from './hitTest';
import type { Shape, ShapeId } from './types';

/**
 * Snap engine. Candidate points are computed EXACTLY from drawing geometry
 * (millimetres). The only screen-dependent input is `tolerance`: the pick
 * radius in drawing mm, which the UI derives from a fixed pixel aperture via
 * the current zoom and drawing scale. The returned point never depends on zoom.
 */
export type ObjectSnapKind = 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest';
export type SnapKind = ObjectSnapKind | 'grid';

export const OBJECT_SNAP_KINDS: readonly ObjectSnapKind[] = [
  'endpoint',
  'midpoint',
  'center',
  'intersection',
  'perpendicular',
  'tangent',
  'nearest',
];

export const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Centre',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'Nearest',
  grid: 'Grid',
};

export interface SnapSettings {
  /** Master switch for object snaps. */
  readonly objectSnap: boolean;
  readonly kinds: Readonly<Record<ObjectSnapKind, boolean>>;
  readonly gridSnap: boolean;
  /** Grid snap increment in drawing mm. */
  readonly gridStepMm: number;
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  objectSnap: true,
  kinds: { endpoint: true, midpoint: true, center: true, intersection: true, perpendicular: true, tangent: true, nearest: false },
  gridSnap: true,
  gridStepMm: 1,
};

export interface SnapContext {
  readonly shapes: readonly Shape[];
  /** Pick radius in drawing millimetres. */
  readonly tolerance: number;
  /** Point the current operation started from (enables perpendicular / tangent). */
  readonly basePoint?: Vec2 | null;
  /** Shapes to ignore (e.g. the shapes being dragged). */
  readonly excludeIds?: ReadonlySet<ShapeId>;
}

export interface SnapResult {
  readonly point: Vec2;
  readonly kind: SnapKind;
  /** Stable link target (endpoint / midpoint / centre snaps only). */
  readonly anchor?: { readonly shapeId: ShapeId; readonly key: string };
  readonly shapeIds: readonly ShapeId[];
}

/** Lower number wins when two candidates are equally close. */
const PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  center: 2,
  midpoint: 3,
  perpendicular: 4,
  tangent: 5,
  nearest: 6,
  grid: 7,
};

/** Tier: a candidate in a lower tier beats any candidate in a higher tier. */
const TIER: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 0,
  center: 0,
  midpoint: 0,
  perpendicular: 1,
  tangent: 1,
  nearest: 2,
  grid: 3,
};

export function snapToGrid(p: Vec2, step: number): Vec2 {
  return vec(snapValue(p.x, step), snapValue(p.y, step));
}

export function findSnap(cursor: Vec2, settings: SnapSettings, ctx: SnapContext): SnapResult | null {
  const tol = ctx.tolerance;
  const candidates: SnapResult[] = [];
  const consider = (r: SnapResult) => {
    if (distance(r.point, cursor) <= tol) candidates.push(r);
  };

  if (settings.objectSnap) {
    const k = settings.kinds;
    const shapes = ctx.shapes.filter((s) => !ctx.excludeIds?.has(s.id));
    // Shapes whose outline or key points are within reach of the cursor.
    const near = shapes.filter(
      (s) => distanceToShape(s, cursor) <= tol || shapeKeyPoints(s).some((kp) => distance(kp.point, cursor) <= tol),
    );

    for (const s of near) {
      for (const kp of shapeKeyPoints(s)) {
        if (k[kp.kind]) consider({ point: kp.point, kind: kp.kind, anchor: { shapeId: s.id, key: kp.key }, shapeIds: [s.id] });
      }
    }

    const prims: { id: ShapeId; prim: Primitive }[] = near
      .filter((s) => distanceToShape(s, cursor) <= tol)
      .flatMap((s) => shapePrimitives(s).map((prim) => ({ id: s.id, prim })));

    if (k.intersection) {
      for (let i = 0; i < prims.length; i++) {
        for (let j = i + 1; j < prims.length; j++) {
          for (const p of intersectPrimitives(prims[i].prim, prims[j].prim)) {
            consider({ point: p, kind: 'intersection', shapeIds: [prims[i].id, prims[j].id] });
          }
        }
      }
    }

    const base = ctx.basePoint;
    if (base) {
      for (const { id, prim } of prims) {
        if (k.perpendicular) for (const p of perpendicularFeet(base, prim)) consider({ point: p, kind: 'perpendicular', shapeIds: [id] });
        if (k.tangent && prim.type !== 'seg') {
          for (const p of tangentPoints(base, prim.c, prim.r)) {
            if (prim.type === 'arc' && !pointOnArc(prim, p)) continue;
            consider({ point: p, kind: 'tangent', shapeIds: [id] });
          }
        }
      }
    }

    if (k.nearest) {
      for (const { id, prim } of prims) consider({ point: nearestOnPrimitive(cursor, prim), kind: 'nearest', shapeIds: [id] });
    }
  }

  if (candidates.length > 0) {
    candidates.sort(
      (a, b) =>
        TIER[a.kind] - TIER[b.kind] ||
        distance(a.point, cursor) - distance(b.point, cursor) ||
        PRIORITY[a.kind] - PRIORITY[b.kind],
    );
    return candidates[0];
  }

  if (settings.gridSnap && settings.gridStepMm > 0) {
    return { point: snapToGrid(cursor, settings.gridStepMm), kind: 'grid', shapeIds: [] };
  }
  return null;
}

/** Snap and return just the point (raw cursor when nothing applies). */
export function snapPoint(cursor: Vec2, settings: SnapSettings, ctx: SnapContext): Vec2 {
  return findSnap(cursor, settings, ctx)?.point ?? cursor;
}
