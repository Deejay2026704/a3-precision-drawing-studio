import type { DrawingScale } from '../geometry/scale';
import type { PageSize } from '../geometry/page';
import type { Vec2 } from '../geometry/vec';

export type ShapeId = string;

/** Visual style. Line weight is in PAPER millimetres (it does not scale with the drawing). */
export interface ShapeStyle {
  readonly stroke: string;
  readonly strokeWidthMm: number;
}

interface ShapeBase {
  readonly id: ShapeId;
  readonly style: ShapeStyle;
}

/** All geometry below is in drawing (real-world) millimetres, origin bottom-left, Y up. */
export interface LineShape extends ShapeBase {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
}

/**
 * Rectangle defined by a base corner, a size along its own axes and a rotation
 * (degrees CCW) about the base corner. Unrotated, `origin` is the bottom-left corner.
 * width and height are always >= 0.
 */
export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly origin: Vec2;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number;
}

export interface CircleShape extends ShapeBase {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly radius: number;
}

/** Freehand polyline (open). */
export interface PolylineShape extends ShapeBase {
  readonly kind: 'polyline';
  readonly points: readonly Vec2[];
}

export type Shape = LineShape | RectShape | CircleShape | PolylineShape;
export type ShapeKind = Shape['kind'];

export interface DrawingDocument {
  readonly page: PageSize;
  readonly scale: DrawingScale;
  /** Painting order: later shapes are drawn on top. */
  readonly shapes: readonly Shape[];
}

export const DEFAULT_STYLE: ShapeStyle = Object.freeze({ stroke: '#000000', strokeWidthMm: 0.35 });

/** Standard ISO pen weights (paper mm). */
export const LINE_WEIGHTS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0] as const;

export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  polyline: 'Freehand polyline',
};
