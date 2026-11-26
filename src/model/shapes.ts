import { angleBetweenPoints, rotateVec } from '../geometry/angles';
import { boundsCenter, boundsOfPoints, type Bounds } from '../geometry/bounds';
import { add, distance, midpoint, vec, type Vec2 } from '../geometry/vec';
import { arcBoundsPoints, normalizeArc } from './arcs';
import { DEFAULT_STYLE, type ArcShape, type CircleShape, type LineShape, type PolylineShape, type RectShape, type Shape, type ShapeId, type ShapeStyle } from './types';

// ---------- constructors ----------

export function createLine(id: ShapeId, start: Vec2, end: Vec2, style: ShapeStyle = DEFAULT_STYLE): LineShape {
  return { id, kind: 'line', start, end, style };
}

/** Axis-aligned rectangle spanning two opposite corners (any order). */
export function createRectFromCorners(id: ShapeId, a: Vec2, b: Vec2, style: ShapeStyle = DEFAULT_STYLE): RectShape {
  return {
    id,
    kind: 'rect',
    origin: vec(Math.min(a.x, b.x), Math.min(a.y, b.y)),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    rotationDeg: 0,
    style,
  };
}

export function createRect(
  id: ShapeId,
  origin: Vec2,
  width: number,
  height: number,
  rotationDeg = 0,
  style: ShapeStyle = DEFAULT_STYLE,
): RectShape {
  if (width < 0 || height < 0) throw new RangeError('Rectangle width and height must be >= 0');
  return { id, kind: 'rect', origin, width, height, rotationDeg, style };
}

export function createCircle(id: ShapeId, center: Vec2, radius: number, style: ShapeStyle = DEFAULT_STYLE): CircleShape {
  if (radius < 0) throw new RangeError('Circle radius must be >= 0');
  return { id, kind: 'circle', center, radius, style };
}

export function createArc(id: ShapeId, center: Vec2, radius: number, startDeg: number, sweepDeg: number, style: ShapeStyle = DEFAULT_STYLE): ArcShape {
  if (!(radius > 0)) throw new RangeError('Arc radius must be greater than zero');
  if (!(sweepDeg > 0 && sweepDeg < 360)) throw new RangeError('Arc sweep must be between 0° and 360°');
  return normalizeArc({ id, kind: 'arc', center, radius, startDeg, sweepDeg, style });
}

export function createPolyline(id: ShapeId, points: readonly Vec2[], style: ShapeStyle = DEFAULT_STYLE): PolylineShape {
  return { id, kind: 'polyline', points: [...points], style };
}

// ---------- measurements ----------

export const lineLength = (l: LineShape): number => distance(l.start, l.end);
export const lineAngle = (l: LineShape): number => angleBetweenPoints(l.start, l.end);

/**
 * Rectangle corners in world coordinates, in local order:
 * [base (local bottom-left), local bottom-right, local top-right, local top-left].
 */
export function rectCorners(r: RectShape): [Vec2, Vec2, Vec2, Vec2] {
  const toWorld = (u: number, v: number) => add(r.origin, rotateVec(vec(u, v), r.rotationDeg));
  return [toWorld(0, 0), toWorld(r.width, 0), toWorld(r.width, r.height), toWorld(0, r.height)];
}

export const rectCenter = (r: RectShape): Vec2 => {
  const c = rectCorners(r);
  return midpoint(c[0], c[2]);
};

export const rectArea = (r: RectShape): number => r.width * r.height;

export function polylineLength(p: PolylineShape): number {
  let total = 0;
  for (let i = 1; i < p.points.length; i++) total += distance(p.points[i - 1], p.points[i]);
  return total;
}

/** Axis-aligned bounds of a shape in world coordinates. */
export function shapeBounds(s: Shape): Bounds {
  switch (s.kind) {
    case 'line':
      return boundsOfPoints([s.start, s.end]);
    case 'rect':
      return boundsOfPoints(rectCorners(s));
    case 'circle':
      return {
        minX: s.center.x - s.radius,
        minY: s.center.y - s.radius,
        maxX: s.center.x + s.radius,
        maxY: s.center.y + s.radius,
      };
    case 'arc':
      return boundsOfPoints(arcBoundsPoints(s));
    case 'polyline':
      return boundsOfPoints(s.points);
  }
}

/** Natural centre of a shape (used as default rotation pivot). */
export function shapeCenter(s: Shape): Vec2 {
  switch (s.kind) {
    case 'line':
      return midpoint(s.start, s.end);
    case 'rect':
      return rectCenter(s);
    case 'circle':
    case 'arc':
      return s.center;
    case 'polyline':
      return boundsCenter(shapeBounds(s));
  }
}
