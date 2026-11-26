import { polarPoint, rotatePoint, rotateVec } from '../geometry/angles';
import { boundsHeight, boundsOfPoints, boundsWidth } from '../geometry/bounds';
import { add, sub, vec, type Vec2 } from '../geometry/vec';
import { arcEnd, arcStart, normalizeArc } from './arcs';
import { lineAngle, lineLength, rectCorners, shapeBounds, shapeCenter } from './shapes';
import type { CircleShape, LineShape, RectShape, Shape, ShapeId } from './types';

/**
 * Pure editing operations. Every function returns a NEW shape and never mutates input.
 * All lengths are world (real) millimetres; all angles are degrees CCW.
 */

const scalePointAbout = (p: Vec2, anchor: Vec2, sx: number, sy: number): Vec2 =>
  vec(anchor.x + (p.x - anchor.x) * sx, anchor.y + (p.y - anchor.y) * sy);

// ---------- move ----------

export function moveShape<S extends Shape>(s: S, dx: number, dy: number): S {
  const d = vec(dx, dy);
  switch (s.kind) {
    case 'line':
      return { ...s, start: add(s.start, d), end: add(s.end, d) };
    case 'rect':
      return { ...s, origin: add(s.origin, d) };
    case 'circle':
    case 'arc':
      return { ...s, center: add(s.center, d) };
    case 'polyline':
      return { ...s, points: s.points.map((p) => add(p, d)) };
    case 'text':
      return { ...s, position: add(s.position, d) };
  }
}

/** Move a shape so that its bounding box minimum corner is at (x, y). */
export function moveBoundsTo<S extends Shape>(s: S, x: number, y: number): S {
  const b = shapeBounds(s);
  return moveShape(s, x - b.minX, y - b.minY);
}

// ---------- rotate ----------

/** Rotate a shape by deg (CCW) about pivot. Defaults to the shape's own centre. */
export function rotateShape<S extends Shape>(s: S, deg: number, pivot: Vec2 = shapeCenter(s)): S {
  switch (s.kind) {
    case 'line':
      return { ...s, start: rotatePoint(s.start, pivot, deg), end: rotatePoint(s.end, pivot, deg) };
    case 'rect':
      return { ...s, origin: rotatePoint(s.origin, pivot, deg), rotationDeg: normalizeRotation(s.rotationDeg + deg) };
    case 'circle':
      return { ...s, center: rotatePoint(s.center, pivot, deg) };
    case 'arc':
      return normalizeArc({ ...s, center: rotatePoint(s.center, pivot, deg), startDeg: s.startDeg + deg }) as S;
    case 'polyline':
      return { ...s, points: s.points.map((p) => rotatePoint(p, pivot, deg)) };
    case 'text':
      return { ...s, position: rotatePoint(s.position, pivot, deg), rotationDeg: normalizeRotation(s.rotationDeg + deg) };
  }
}

/** Rotation stored in (-180, 180] for readability. */
export function normalizeRotation(deg: number): number {
  let r = deg % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

/** Set the absolute rotation of a rectangle, rotating about its base corner (origin stays fixed). */
export function setRectRotation(r: RectShape, deg: number): RectShape {
  return { ...r, rotationDeg: normalizeRotation(deg) };
}

// ---------- lines ----------

/** Change line length keeping the start point and direction. */
export function setLineLength(l: LineShape, newLength: number): LineShape {
  if (!(newLength >= 0)) throw new RangeError('Line length must be >= 0');
  return { ...l, end: polarPoint(l.start, newLength, lineAngle(l)) };
}

/** Change line direction keeping the start point and length. */
export function setLineAngle(l: LineShape, deg: number): LineShape {
  return { ...l, end: polarPoint(l.start, lineLength(l), deg) };
}

// ---------- size ----------

export function setRectSize(r: RectShape, width: number, height: number): RectShape {
  if (!(width >= 0) || !(height >= 0)) throw new RangeError('Rectangle width and height must be >= 0');
  return { ...r, width, height };
}

export function setCircleRadius(c: CircleShape, radius: number): CircleShape {
  if (!(radius >= 0)) throw new RangeError('Circle radius must be >= 0');
  return { ...c, radius };
}

/**
 * Scale a shape by (sx, sy) about an anchor point.
 * Lines and polylines scale exactly (non-uniform allowed, negative = mirror).
 * Circles and rotated rectangles cannot stay circles/rectangles under
 * non-uniform scaling, so they use the geometric mean sqrt(|sx·sy|) as a uniform factor.
 * Rectangles aligned to the axes (rotation multiple of 90°) scale exactly.
 */
export function scaleShape<S extends Shape>(s: S, sx: number, sy: number, anchor: Vec2): S {
  switch (s.kind) {
    case 'line':
      return { ...s, start: scalePointAbout(s.start, anchor, sx, sy), end: scalePointAbout(s.end, anchor, sx, sy) };
    case 'polyline':
      return { ...s, points: s.points.map((p) => scalePointAbout(p, anchor, sx, sy)) };
    case 'text':
      // Text keeps its proportions and stays readable: uniform size factor, no mirroring.
      return { ...s, position: scalePointAbout(s.position, anchor, sx, sy), height: s.height * Math.sqrt(Math.abs(sx * sy)) };
    case 'circle': {
      const k = Math.sqrt(Math.abs(sx * sy));
      return { ...s, center: scalePointAbout(s.center, anchor, sx, sy), radius: s.radius * k };
    }
    case 'arc': {
      // Uniform factor (an arc stays circular); a negative determinant mirrors, reversing orientation.
      const k = Math.sqrt(Math.abs(sx * sy));
      const c = scalePointAbout(s.center, anchor, sx, sy);
      const ang = (p: Vec2) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
      const sp = scalePointAbout(arcStart(s), anchor, sx, sy);
      const ep = scalePointAbout(arcEnd(s), anchor, sx, sy);
      return normalizeArc({ ...s, center: c, radius: s.radius * k, startDeg: sx * sy < 0 ? ang(ep) : ang(sp) }) as S;
    }
    case 'rect': {
      const axisAligned = Math.abs(s.rotationDeg % 90) < 1e-9;
      if (axisAligned) {
        const b = boundsOfPoints(rectCorners(s).map((p) => scalePointAbout(p, anchor, sx, sy)));
        return { ...s, origin: vec(b.minX, b.minY), width: boundsWidth(b), height: boundsHeight(b), rotationDeg: 0 };
      }
      const k = Math.sqrt(Math.abs(sx * sy));
      return { ...s, origin: scalePointAbout(s.origin, anchor, k, k), width: s.width * k, height: s.height * k };
    }
  }
}

/** Set the bounding-box size of a shape, keeping its bounding-box minimum corner fixed. */
export function setBoundsSize<S extends Shape>(s: S, width: number, height: number): S {
  if (!(width >= 0) || !(height >= 0)) throw new RangeError('Width and height must be >= 0');
  const b = shapeBounds(s);
  const w = boundsWidth(b);
  const h = boundsHeight(b);
  const sx = w > 1e-12 ? width / w : 1;
  const sy = h > 1e-12 ? height / h : 1;
  return scaleShape(s, sx, sy, vec(b.minX, b.minY));
}

// ---------- duplicate ----------

export function duplicateShape<S extends Shape>(s: S, newId: ShapeId, offset: Vec2): S {
  return { ...moveShape(s, offset.x, offset.y), id: newId };
}

// ---------- rectangle handle resizing in the rectangle's local frame ----------

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Convert a world point into a rectangle's local frame (origin at base corner, axes along the sides). */
export const rectLocalPoint = (r: RectShape, p: Vec2): Vec2 => rotateVec(sub(p, r.origin), -r.rotationDeg);

/**
 * Resize a rectangle by dragging one of its eight handles to world point p.
 * The opposite side/corner stays fixed; rotation is preserved.
 */
export function resizeRectByHandle(r: RectShape, handle: BoxHandle, p: Vec2): RectShape {
  const local = rectLocalPoint(r, p);
  let u0 = 0;
  let v0 = 0;
  let u1 = r.width;
  let v1 = r.height;
  if (handle.includes('w')) u0 = local.x;
  if (handle.includes('e')) u1 = local.x;
  if (handle.includes('s')) v0 = local.y;
  if (handle.includes('n')) v1 = local.y;
  const minU = Math.min(u0, u1);
  const minV = Math.min(v0, v1);
  return {
    ...r,
    origin: add(r.origin, rotateVec(vec(minU, minV), r.rotationDeg)),
    width: Math.abs(u1 - u0),
    height: Math.abs(v1 - v0),
  };
}

/**
 * Resize any shape's axis-aligned bounding box by dragging one of its eight handles to p.
 * The opposite side/corner of the bounding box stays fixed.
 */
export function resizeBoundsByHandle<S extends Shape>(s: S, handle: BoxHandle, p: Vec2): S {
  const b = shapeBounds(s);
  const w = boundsWidth(b);
  const h = boundsHeight(b);
  let sx = 1;
  let sy = 1;
  let ax = b.minX;
  let ay = b.minY;
  if (handle.includes('e') && w > 1e-12) { ax = b.minX; sx = (p.x - b.minX) / w; }
  if (handle.includes('w') && w > 1e-12) { ax = b.maxX; sx = (b.maxX - p.x) / w; }
  if (handle.includes('n') && h > 1e-12) { ay = b.minY; sy = (p.y - b.minY) / h; }
  if (handle.includes('s') && h > 1e-12) { ay = b.maxY; sy = (b.maxY - p.y) / h; }
  return scaleShape(s, sx, sy, vec(ax, ay));
}

/** Uniform scale factor when dragging a corner from `from` to `to` with `anchor` fixed. */
export function uniformScaleFactor(anchor: Vec2, from: Vec2, to: Vec2): number {
  const dir = sub(from, anchor);
  // Exact squared length (avoids the rounding of squaring Math.hypot).
  const lenSq = dir.x * dir.x + dir.y * dir.y;
  if (lenSq < 1e-24) return 1;
  // Project onto the anchor→corner direction so that dragging "inwards" shrinks.
  const proj = ((to.x - anchor.x) * dir.x + (to.y - anchor.y) * dir.y) / lenSq;
  return Math.max(1e-6, proj);
}
