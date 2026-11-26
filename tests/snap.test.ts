import { describe, expect, it } from 'vitest';
import { screenLengthToWorld, screenToWorld, worldToScreen } from '../src/geometry/coords';
import { distance, vec } from '../src/geometry/vec';
import { DEFAULT_SNAP_SETTINGS, findSnap, type ObjectSnapKind, type SnapSettings } from '../src/model/snap';
import { createCircle, createLine, createPolyline, createRect } from '../src/model/shapes';
import { resolveAnchor } from '../src/model/anchors';

const only = (...kinds: ObjectSnapKind[]): SnapSettings => ({
  objectSnap: true,
  gridSnap: false,
  gridStepMm: 1,
  kinds: { endpoint: false, midpoint: false, center: false, intersection: false, perpendicular: false, tangent: false, nearest: false, ...Object.fromEntries(kinds.map((k) => [k, true])) },
});

const line = createLine('L', vec(0, 0), vec(100, 0));
const cross = createLine('X', vec(50, -20), vec(50, 20));
const circle = createCircle('C', vec(200, 0), 30);
const rect = createRect('R', vec(300, 0), 40, 20);

describe('object snaps', () => {
  it('endpoint snaps exactly and links to the shape', () => {
    const r = findSnap(vec(99.3, 0.4), only('endpoint'), { shapes: [line], tolerance: 2 })!;
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual(vec(100, 0));
    expect(r.anchor).toEqual({ shapeId: 'L', key: 'end' });
    expect(resolveAnchor({ shapes: [line] }, { kind: 'shape', ...r.anchor! })).toEqual(vec(100, 0));
  });

  it('midpoint of a line and of a rectangle edge', () => {
    expect(findSnap(vec(25.5, 0.5), only('midpoint'), { shapes: [createLine('l', vec(0, 0), vec(51, 0))], tolerance: 2 })!.point).toEqual(vec(25.5, 0));
    expect(findSnap(vec(320, 21), only('midpoint'), { shapes: [rect], tolerance: 2 })!.point).toEqual(vec(320, 20));
  });

  it('centre of a circle and of a rectangle', () => {
    expect(findSnap(vec(201, 1), only('center'), { shapes: [circle], tolerance: 2 })!.point).toEqual(vec(200, 0));
    expect(findSnap(vec(320.5, 10.5), only('center'), { shapes: [rect], tolerance: 2 })!.point).toEqual(vec(320, 10));
  });

  it('intersection of two lines and of a line with a circle', () => {
    expect(findSnap(vec(51, 1), only('intersection'), { shapes: [line, cross], tolerance: 2 })!.point).toEqual(vec(50, 0));
    const through = createLine('T', vec(150, 0), vec(250, 0));
    const r = findSnap(vec(171, 0.5), only('intersection'), { shapes: [through, circle], tolerance: 2 })!;
    expect(r.point.x).toBeCloseTo(170, 12);
    expect(r.point.y).toBeCloseTo(0, 12);
  });

  it('parallel lines give no intersection snap', () => {
    const a = createLine('a', vec(0, 0), vec(100, 0));
    const b = createLine('b', vec(0, 1), vec(100, 1));
    expect(findSnap(vec(50, 0.5), only('intersection'), { shapes: [a, b], tolerance: 2 })).toBeNull();
  });

  it('non-intersecting objects give no intersection snap', () => {
    const a = createLine('a', vec(0, 0), vec(10, 0));
    const b = createLine('b', vec(20, -5), vec(20, 5));
    expect(findSnap(vec(15, 0), only('intersection'), { shapes: [a, b], tolerance: 10 })).toBeNull();
  });

  it('perpendicular from the base point', () => {
    const r = findSnap(vec(31, 0.8), only('perpendicular'), { shapes: [line], tolerance: 2, basePoint: vec(30, 50) })!;
    expect(r.kind).toBe('perpendicular');
    expect(r.point).toEqual(vec(30, 0));
    // no base point → no perpendicular snap
    expect(findSnap(vec(31, 0.8), only('perpendicular'), { shapes: [line], tolerance: 2 })).toBeNull();
  });

  it('tangent from the base point to a circle', () => {
    const base = vec(200, 60); // 60 from centre, r = 30 → tangent points at ±60° from the axis
    const expected = vec(200 + 30 * Math.cos(Math.PI / 6), 30 * Math.sin(Math.PI / 6));
    const r = findSnap(vec(expected.x + 0.5, expected.y), only('tangent'), { shapes: [circle], tolerance: 2, basePoint: base })!;
    expect(r.kind).toBe('tangent');
    expect(distance(r.point, expected)).toBeLessThan(1e-9);
  });

  it('nearest point on a circle is exactly on the circle', () => {
    const r = findSnap(vec(231.2, 3), only('nearest'), { shapes: [circle], tolerance: 2 })!;
    expect(distance(r.point, vec(200, 0))).toBeCloseTo(30, 12);
  });

  it('endpoint beats nearest; tiers outrank distance', () => {
    const r = findSnap(vec(98.5, 0.2), { ...DEFAULT_SNAP_SETTINGS, kinds: { ...DEFAULT_SNAP_SETTINGS.kinds, nearest: true } }, { shapes: [line], tolerance: 2 })!;
    expect(r.kind).toBe('endpoint');
  });

  it('individually disabled snaps are ignored', () => {
    expect(findSnap(vec(99.5, 0), only('midpoint'), { shapes: [line], tolerance: 2 })).toBeNull();
  });

  it('excluded shapes are ignored', () => {
    expect(findSnap(vec(99.5, 0), only('endpoint'), { shapes: [line], tolerance: 2, excludeIds: new Set(['L']) })).toBeNull();
  });

  it('zero-length geometry is handled without errors', () => {
    const dot = createLine('z', vec(5, 5), vec(5, 5));
    const r = findSnap(vec(5.2, 5), DEFAULT_SNAP_SETTINGS, { shapes: [dot, createPolyline('p', [vec(1, 1)])], tolerance: 1 })!;
    expect(r.point).toEqual(vec(5, 5));
  });

  it('falls back to grid snap, and to null with everything off', () => {
    const s = { ...DEFAULT_SNAP_SETTINGS, gridStepMm: 5 };
    expect(findSnap(vec(12.4, 18), s, { shapes: [], tolerance: 1 })).toMatchObject({ kind: 'grid', point: vec(10, 20) });
    expect(findSnap(vec(12.4, 18), { ...s, gridSnap: false }, { shapes: [], tolerance: 1 })).toBeNull();
  });
});

describe('snapping across zoom levels and drawing scales', () => {
  const scenarios = [
    { scale: { paper: 1, real: 1 }, zoom: 0.25 },
    { scale: { paper: 1, real: 1 }, zoom: 4 },
    { scale: { paper: 1, real: 50 }, zoom: 1 },
    { scale: { paper: 1, real: 100 }, zoom: 12 },
    { scale: { paper: 2, real: 1 }, zoom: 0.5 },
  ];
  const target = createLine('t', vec(1234.567, 890.123), vec(4321, 765));

  it.each(scenarios)('cursor 5 px from an endpoint snaps to the exact endpoint (%o)', ({ scale, zoom }) => {
    const t = { scale, viewport: { zoom, originX: 40, originY: 900 } };
    const screenEnd = worldToScreen(target.start, t);
    const cursor = screenToWorld(vec(screenEnd.x + 3, screenEnd.y - 4), t);
    const r = findSnap(cursor, DEFAULT_SNAP_SETTINGS, { shapes: [target], tolerance: screenLengthToWorld(10, t) })!;
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual(target.start); // bit-exact, independent of zoom/scale
  });

  it.each(scenarios)('cursor 25 px away does not capture the endpoint (%o)', ({ scale, zoom }) => {
    const t = { scale, viewport: { zoom, originX: 40, originY: 900 } };
    const screenEnd = worldToScreen(target.start, t);
    const cursor = screenToWorld(vec(screenEnd.x - 25, screenEnd.y), t);
    const r = findSnap(cursor, { ...DEFAULT_SNAP_SETTINGS, gridSnap: false }, { shapes: [target], tolerance: screenLengthToWorld(10, t) });
    expect(r).toBeNull();
  });
});
