import { describe, expect, it } from 'vitest';
import { normalizeAngle, rotatePoint, rotateVec } from '../src/geometry/angles';
import { vec, vecApproxEqual, distance } from '../src/geometry/vec';
import { createCircle, createLine, createPolyline, createRect, lineLength, rectCenter, rectCorners } from '../src/model/shapes';
import { normalizeRotation, rotateShape, setRectRotation } from '../src/model/operations';
import { applyHandleDrag, getSelectionFrame } from '../src/model/handles';

describe('rotation', () => {
  it('rotates points counter-clockwise about a pivot', () => {
    expect(vecApproxEqual(rotateVec(vec(1, 0), 90), vec(0, 1))).toBe(true);
    expect(vecApproxEqual(rotatePoint(vec(20, 10), vec(10, 10), 90), vec(10, 20))).toBe(true);
    expect(vecApproxEqual(rotatePoint(vec(20, 10), vec(10, 10), -90), vec(10, 0))).toBe(true);
  });

  it('normalises angles', () => {
    expect(normalizeAngle(370)).toBeCloseTo(10, 12);
    expect(normalizeAngle(-90)).toBeCloseTo(270, 12);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeRotation(270)).toBe(-90);
    expect(normalizeRotation(-190)).toBe(170);
  });

  it('rotating a line about its midpoint preserves length and midpoint', () => {
    const l = createLine('l', vec(0, 0), vec(100, 0));
    const r = rotateShape(l, 90);
    expect(vecApproxEqual(r.start, vec(50, -50))).toBe(true);
    expect(vecApproxEqual(r.end, vec(50, 50))).toBe(true);
    expect(lineLength(r)).toBeCloseTo(100, 10);
  });

  it('rotating a rectangle about its centre keeps size and centre, updates rotation', () => {
    const rect = createRect('r', vec(10, 10), 100, 40);
    const centre = rectCenter(rect);
    const r = rotateShape(rect, 30);
    expect(r.rotationDeg).toBeCloseTo(30, 12);
    expect(r.width).toBe(100);
    expect(r.height).toBe(40);
    expect(vecApproxEqual(rectCenter(r), centre)).toBe(true);
    const c = rectCorners(r);
    expect(distance(c[0], c[1])).toBeCloseTo(100, 10);
    expect(distance(c[1], c[2])).toBeCloseTo(40, 10);
  });

  it('setting a rectangle rotation pivots about its base corner', () => {
    const r = setRectRotation(createRect('r', vec(10, 10), 100, 40), 90);
    expect(r.origin).toEqual(vec(10, 10));
    expect(vecApproxEqual(rectCorners(r)[1], vec(10, 110))).toBe(true);
  });

  it('rotating 360° in steps returns to the original geometry', () => {
    let p = createPolyline('p', [vec(0, 0), vec(10, 5), vec(20, -3)]);
    for (let i = 0; i < 12; i++) p = rotateShape(p, 30, vec(7, 7));
    p.points.forEach((pt, i) => expect(vecApproxEqual(pt, [vec(0, 0), vec(10, 5), vec(20, -3)][i], 1e-9)).toBe(true));
  });

  it('rotating a circle about an external pivot moves its centre only', () => {
    const c = rotateShape(createCircle('c', vec(20, 0), 5), 90, vec(0, 0));
    expect(vecApproxEqual(c.center, vec(0, 20))).toBe(true);
    expect(c.radius).toBe(5);
  });

  it('rotate handle drag rotates about the selection pivot (with 15° snapping)', () => {
    const rect = createRect('r', vec(0, 0), 100, 50);
    const frame = getSelectionFrame([rect], 10)!;
    const pivot = frame.pivot; // centre (50, 25)
    const start = vec(50, 100);
    const current = rotatePoint(start, pivot, 44); // ~44° → snaps to 45°
    const [rotated] = applyHandleDrag([rect], frame, 'rotate', start, current, { constrain: true });
    expect((rotated as typeof rect).rotationDeg).toBeCloseTo(45, 9);
    expect(vecApproxEqual(rectCenter(rotated as typeof rect), pivot)).toBe(true);
  });
});
