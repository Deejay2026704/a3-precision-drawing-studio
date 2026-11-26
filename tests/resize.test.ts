import { describe, expect, it } from 'vitest';
import { vec, vecApproxEqual } from '../src/geometry/vec';
import { boundsHeight, boundsWidth } from '../src/geometry/bounds';
import { createCircle, createLine, createPolyline, createRect, rectCorners, shapeBounds } from '../src/model/shapes';
import { resizeRectByHandle, scaleShape, setBoundsSize, setCircleRadius, uniformScaleFactor } from '../src/model/operations';
import { applyHandleDrag, getSelectionFrame } from '../src/model/handles';
import type { RectShape } from '../src/model/types';

describe('object resizing', () => {
  const rect = createRect('r', vec(10, 10), 100, 50);

  it('dragging the NE handle resizes with the SW corner fixed', () => {
    const r = resizeRectByHandle(rect, 'ne', vec(160, 90));
    expect(r.origin).toEqual(vec(10, 10));
    expect(r.width).toBe(150);
    expect(r.height).toBe(80);
  });

  it('dragging an edge handle changes only one dimension', () => {
    const r = resizeRectByHandle(rect, 'w', vec(30, 999));
    expect(r.origin).toEqual(vec(30, 10));
    expect(r.width).toBe(80);
    expect(r.height).toBe(50);
  });

  it('dragging past the opposite side flips but keeps positive size', () => {
    const r = resizeRectByHandle(rect, 'e', vec(0, 0));
    expect(r.origin).toEqual(vec(0, 10));
    expect(r.width).toBe(10);
    expect(r.height).toBe(50);
  });

  it('resizes a rotated rectangle in its own frame (opposite corner fixed)', () => {
    const rot = createRect('r', vec(0, 0), 100, 50, 90);
    const fixed = rectCorners(rot)[0];
    const ne = rectCorners(rot)[2]; // (-50, 100)
    const r = resizeRectByHandle(rot, 'ne', vec(ne.x - 10, ne.y + 20)); // +20 along local x, +10 along local y
    expect(r.rotationDeg).toBe(90);
    expect(r.width).toBeCloseTo(120, 10);
    expect(r.height).toBeCloseTo(60, 10);
    expect(vecApproxEqual(rectCorners(r)[0], fixed)).toBe(true);
  });

  it('resizes polylines via bounding-box handles', () => {
    const p = createPolyline('p', [vec(0, 0), vec(10, 10), vec(20, 0)]);
    const frame = getSelectionFrame([p], 5)!;
    const [q] = applyHandleDrag([p], frame, 'ne', vec(20, 10), vec(40, 30));
    const b = shapeBounds(q);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 30 });
  });

  it('sets an exact bounding size for a polyline, anchored at its lower-left', () => {
    const p = setBoundsSize(createPolyline('p', [vec(5, 5), vec(15, 25)]), 50, 10);
    const b = shapeBounds(p);
    expect(b.minX).toBe(5);
    expect(b.minY).toBe(5);
    expect(boundsWidth(b)).toBeCloseTo(50, 10);
    expect(boundsHeight(b)).toBeCloseTo(10, 10);
  });

  it('line endpoint handles move one end only', () => {
    const l = createLine('l', vec(0, 0), vec(10, 0));
    const frame = getSelectionFrame([l], 5)!;
    const [m] = applyHandleDrag([l], frame, 'end', vec(10, 0), vec(30, 40));
    expect(m).toMatchObject({ start: vec(0, 0), end: vec(30, 40) });
  });

  it('circle handles set the radius from the centre', () => {
    const c = createCircle('c', vec(50, 50), 10);
    const frame = getSelectionFrame([c], 5)!;
    const [m] = applyHandleDrag([c], frame, 'e', vec(60, 50), vec(75, 50));
    expect(m).toMatchObject({ center: vec(50, 50), radius: 25 });
    expect(setCircleRadius(c, 12.5).radius).toBe(12.5);
  });

  it('multi-selection resizes proportionally about the opposite corner', () => {
    const a = createRect('a', vec(0, 0), 10, 10);
    const b = createCircle('b', vec(30, 30), 10); // bounds to (40,40)
    const frame = getSelectionFrame([a, b], 5)!;
    expect(frame.mode).toBe('multi');
    const [ra, cb] = applyHandleDrag([a, b], frame, 'ne', vec(40, 40), vec(80, 80));
    expect(ra as RectShape).toMatchObject({ origin: vec(0, 0), width: 20, height: 20 });
    expect(cb).toMatchObject({ center: vec(60, 60), radius: 20 });
  });

  it('uniform scale factor projects onto the drag direction', () => {
    expect(uniformScaleFactor(vec(0, 0), vec(10, 10), vec(20, 20))).toBeCloseTo(2, 12);
    expect(uniformScaleFactor(vec(0, 0), vec(10, 10), vec(5, 5))).toBeCloseTo(0.5, 12);
  });

  it('scaling an axis-aligned rectangle non-uniformly stays exact', () => {
    const r = scaleShape(rect, 2, 0.5, vec(10, 10));
    expect(r).toMatchObject({ origin: vec(10, 10), width: 200, height: 25 });
  });
});
