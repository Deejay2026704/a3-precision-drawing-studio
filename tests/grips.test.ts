import { describe, expect, it } from 'vitest';
import { screenLengthToWorld, screenToWorld, worldToScreen } from '../src/geometry/coords';
import { vec } from '../src/geometry/vec';
import { applyHandleDrag, getSelectionFrame } from '../src/model/handles';
import { createCircle, createLine, createPolyline, createRect, rectCenter } from '../src/model/shapes';
import { DEFAULT_SNAP_SETTINGS, snapPoint } from '../src/model/snap';
import type { Shape } from '../src/model/types';

describe('endpoint and centre grips', () => {
  it('every editable shape exposes endpoint and/or centre grips', () => {
    const ids = (s: Shape) => getSelectionFrame([s], 5)!.handles.map((h) => h.id);
    expect(ids(createLine('l', vec(0, 0), vec(10, 0)))).toEqual(expect.arrayContaining(['start', 'end', 'move']));
    expect(ids(createRect('r', vec(0, 0), 10, 5))).toContain('move');
    expect(ids(createCircle('c', vec(0, 0), 5))).toContain('move');
    expect(ids(createPolyline('p', [vec(0, 0), vec(5, 5), vec(10, 0)]))).toEqual(expect.arrayContaining(['start', 'end']));
  });

  it('centre grip moves a circle so its centre lands on the snapped point', () => {
    const c = createCircle('c', vec(10, 10), 5);
    const target = createLine('t', vec(40, 40), vec(80, 40));
    const frame = getSelectionFrame([c], 5)!;
    const snap = (p: { x: number; y: number }) => snapPoint(p, DEFAULT_SNAP_SETTINGS, { shapes: [target], tolerance: 2 });
    const [m] = applyHandleDrag([c], frame, 'move', vec(10.4, 9.7), vec(40.6, 39.2), { snapPoint: snap });
    expect(m).toMatchObject({ center: vec(40, 40), radius: 5 });
  });

  it('midpoint grip moves a line; rectangle centre grip moves a rectangle', () => {
    const l = createLine('l', vec(0, 0), vec(10, 0));
    const [ml] = applyHandleDrag([l], getSelectionFrame([l], 5)!, 'move', vec(5, 0), vec(25, 7));
    expect(ml).toMatchObject({ start: vec(20, 7), end: vec(30, 7) });
    const r = createRect('r', vec(0, 0), 10, 4, 30);
    const [mr] = applyHandleDrag([r], getSelectionFrame([r], 5)!, 'move', rectCenter(r), vec(100, 100));
    const c = rectCenter(mr as typeof r);
    expect(c.x).toBeCloseTo(100, 12);
    expect(c.y).toBeCloseTo(100, 12);
    expect(mr).toMatchObject({ width: 10, height: 4, rotationDeg: 30 });
  });

  it('polyline end grips move only the first / last vertex', () => {
    const p = createPolyline('p', [vec(0, 0), vec(5, 5), vec(10, 0)]);
    const [m] = applyHandleDrag([p], getSelectionFrame([p], 5)!, 'end', vec(10, 0), vec(20, 3));
    expect((m as typeof p).points).toEqual([vec(0, 0), vec(5, 5), vec(20, 3)]);
  });

  it('a grip edit gives the same exact geometry at every zoom level', () => {
    const l = createLine('l', vec(0, 0), vec(10, 0));
    const target = createCircle('t', vec(123.456, 78.9), 3);
    const results = [0.2, 1, 7.5, 30].map((zoom) => {
      const t = { scale: { paper: 1, real: 5 }, viewport: { zoom, originX: 50, originY: 700 } };
      const nearCentre = worldToScreen(target.center, t);
      const cursor = screenToWorld(vec(nearCentre.x + 4, nearCentre.y + 3), t);
      const snap = (p: { x: number; y: number }) =>
        snapPoint(p, DEFAULT_SNAP_SETTINGS, { shapes: [target], tolerance: screenLengthToWorld(10, t) });
      return applyHandleDrag([l], getSelectionFrame([l], 5)!, 'end', l.end, cursor, { snapPoint: snap })[0];
    });
    for (const r of results) expect(r).toMatchObject({ start: vec(0, 0), end: target.center });
  });
});
