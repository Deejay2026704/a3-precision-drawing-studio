import { angleBetweenPoints, rotatePoint, rotateVec, snapAngle } from '../geometry/angles';
import { boundsCenter, unionBounds, type Bounds } from '../geometry/bounds';
import { add, midpoint, vec, type Vec2 } from '../geometry/vec';
import { resizeBoundsByHandle, resizeRectByHandle, rotateShape, scaleShape, uniformScaleFactor, type BoxHandle } from './operations';
import { rectCorners, shapeBounds, shapeCenter } from './shapes';
import type { Shape } from './types';

/**
 * Selection handles, computed in WORLD coordinates from the model.
 * The UI converts them to screen positions for drawing and hit testing.
 */
export type HandleId = BoxHandle | 'start' | 'end' | 'rotate';

export interface Handle {
  readonly id: HandleId;
  readonly position: Vec2;
}

export type FrameMode = 'line' | 'rect' | 'circle' | 'box' | 'multi';

export interface SelectionFrame {
  readonly mode: FrameMode;
  /** Outline polygon of the selection (world coordinates). */
  readonly outline: readonly Vec2[];
  readonly handles: readonly Handle[];
  /** Pivot for the rotate handle. */
  readonly pivot: Vec2;
}

const boxCorners = (b: Bounds): Vec2[] => [vec(b.minX, b.minY), vec(b.maxX, b.minY), vec(b.maxX, b.maxY), vec(b.minX, b.maxY)];

/** Eight handles (+ rotate) for a quadrilateral given in local order bl, br, tr, tl. */
function boxHandles(c: readonly Vec2[], upDeg: number, rotateOffset: number, corners8 = true): Handle[] {
  const [bl, br, tr, tl] = c;
  const handles: Handle[] = [
    { id: 'sw', position: bl },
    { id: 'se', position: br },
    { id: 'ne', position: tr },
    { id: 'nw', position: tl },
  ];
  if (corners8) {
    handles.push(
      { id: 's', position: midpoint(bl, br) },
      { id: 'e', position: midpoint(br, tr) },
      { id: 'n', position: midpoint(tr, tl) },
      { id: 'w', position: midpoint(tl, bl) },
    );
  }
  handles.push({ id: 'rotate', position: add(midpoint(tr, tl), rotateVec(vec(0, rotateOffset), upDeg)) });
  return handles;
}

/**
 * @param rotateOffset distance (world mm) of the rotate handle above the selection;
 *                     the UI passes a fixed screen distance converted to world mm.
 */
export function getSelectionFrame(shapes: readonly Shape[], rotateOffset: number): SelectionFrame | null {
  if (shapes.length === 0) return null;
  if (shapes.length === 1) {
    const s = shapes[0];
    switch (s.kind) {
      case 'line': {
        const mid = midpoint(s.start, s.end);
        return {
          mode: 'line',
          outline: [s.start, s.end],
          pivot: mid,
          handles: [
            { id: 'start', position: s.start },
            { id: 'end', position: s.end },
            { id: 'rotate', position: add(mid, vec(0, rotateOffset)) },
          ],
        };
      }
      case 'rect': {
        const c = rectCorners(s);
        return { mode: 'rect', outline: c, pivot: shapeCenter(s), handles: boxHandles(c, s.rotationDeg, rotateOffset) };
      }
      case 'circle': {
        const { center: c, radius: r } = s;
        return {
          mode: 'circle',
          outline: boxCorners(shapeBounds(s)),
          pivot: c,
          handles: [
            { id: 'n', position: vec(c.x, c.y + r) },
            { id: 'e', position: vec(c.x + r, c.y) },
            { id: 's', position: vec(c.x, c.y - r) },
            { id: 'w', position: vec(c.x - r, c.y) },
          ],
        };
      }
      case 'polyline': {
        const b = shapeBounds(s);
        const c = boxCorners(b);
        return { mode: 'box', outline: c, pivot: boundsCenter(b), handles: boxHandles(c, 0, rotateOffset) };
      }
    }
  }
  const b = unionBounds(shapes.map(shapeBounds));
  const c = boxCorners(b);
  return { mode: 'multi', outline: c, pivot: boundsCenter(b), handles: boxHandles(c, 0, rotateOffset, false) };
}

export interface HandleDragOptions {
  /** Shift key: snap rotation to 15° steps; lines: 15° direction steps. */
  readonly constrain?: boolean;
  /** Optional world-point snapping (e.g. grid). */
  readonly snapPoint?: (p: Vec2) => Vec2;
}

const OPPOSITE: Record<BoxHandle, BoxHandle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

/**
 * Apply a handle drag. Always computed from the ORIGINAL shapes captured at drag start
 * (no incremental drift). Returns the transformed shapes in the same order.
 */
export function applyHandleDrag(
  originals: readonly Shape[],
  frame: SelectionFrame,
  handle: HandleId,
  start: Vec2,
  current: Vec2,
  opts: HandleDragOptions = {},
): Shape[] {
  if (handle === 'rotate') {
    let delta = angleBetweenPoints(frame.pivot, current) - angleBetweenPoints(frame.pivot, start);
    if (opts.constrain) delta = snapAngle(delta, 15);
    return originals.map((s) => rotateShape(s, delta, frame.pivot));
  }
  const p = opts.snapPoint ? opts.snapPoint(current) : current;

  if (frame.mode === 'multi') {
    const corner = handle as BoxHandle;
    const opp = frame.handles.find((h) => h.id === OPPOSITE[corner]);
    const from = frame.handles.find((h) => h.id === corner);
    if (!opp || !from) return [...originals];
    const k = uniformScaleFactor(opp.position, from.position, p);
    return originals.map((s) => scaleShape(s, k, k, opp.position));
  }

  const s = originals[0];
  switch (s.kind) {
    case 'line': {
      const fixed = handle === 'start' ? s.end : s.start;
      let q = p;
      if (opts.constrain) {
        const ang = snapAngle(angleBetweenPoints(fixed, current), 15);
        const len = Math.hypot(current.x - fixed.x, current.y - fixed.y);
        q = rotatePoint(vec(fixed.x + len, fixed.y), fixed, ang);
      }
      return [handle === 'start' ? { ...s, start: q } : { ...s, end: q }];
    }
    case 'rect':
      return [resizeRectByHandle(s, handle as BoxHandle, p)];
    case 'circle':
      return [{ ...s, radius: Math.hypot(p.x - s.center.x, p.y - s.center.y) }];
    case 'polyline':
      return [resizeBoundsByHandle(s, handle as BoxHandle, p)];
  }
}
