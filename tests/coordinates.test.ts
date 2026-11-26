import { describe, expect, it } from 'vitest';
import { screenLengthToWorld, screenToWorld, worldToScreen, pxPerWorldMm } from '../src/geometry/coords';
import { pageToWorld, worldToPage } from '../src/geometry/scale';
import { CSS_PX_PER_MM } from '../src/geometry/page';
import { pageToScreen, screenToPage, zoomAt, panBy } from '../src/geometry/viewport';
import { vec } from '../src/geometry/vec';

const vp = { zoom: 2, originX: 100, originY: 700 };
const k = 2 * CSS_PX_PER_MM;

describe('coordinate conversion', () => {
  it('page origin (0,0) is the bottom-left corner of the sheet on screen', () => {
    expect(pageToScreen(vec(0, 0), vp)).toEqual({ x: 100, y: 700 });
  });

  it('positive page Y goes UP the screen, positive X goes right', () => {
    const p = pageToScreen(vec(10, 20), vp);
    expect(p.x).toBeCloseTo(100 + 10 * k, 9);
    expect(p.y).toBeCloseTo(700 - 20 * k, 9);
    expect(p.y).toBeLessThan(700);
  });

  it('the top-right page corner maps above and right of the origin', () => {
    const tr = pageToScreen(vec(420, 297), vp);
    expect(tr.x).toBeCloseTo(100 + 420 * k, 9);
    expect(tr.y).toBeCloseTo(700 - 297 * k, 9);
  });

  it('screen → page is the exact inverse of page → screen', () => {
    for (const p of [vec(0, 0), vec(420, 297), vec(12.345, 67.891), vec(-5, 400)]) {
      const back = screenToPage(pageToScreen(p, vp), vp);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('world ↔ page conversion respects the drawing scale', () => {
    const s = { paper: 1, real: 50 };
    expect(worldToPage(vec(5000, 2500), s)).toEqual({ x: 100, y: 50 });
    expect(pageToWorld(vec(100, 50), s)).toEqual({ x: 5000, y: 2500 });
  });

  it('world → screen → world round-trips at any scale and zoom', () => {
    for (const scale of [{ paper: 1, real: 1 }, { paper: 1, real: 20 }, { paper: 1, real: 100 }, { paper: 2, real: 1 }, { paper: 1, real: 33 }]) {
      for (const zoom of [0.3, 1, 7]) {
        const t = { scale, viewport: { zoom, originX: 37, originY: 812 } };
        const p = vec(1234.5678, -98.7654);
        const back = screenToWorld(worldToScreen(p, t), t);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('screen lengths convert to world lengths using zoom and scale', () => {
    const t = { scale: { paper: 1, real: 10 }, viewport: { zoom: 1, originX: 0, originY: 0 } };
    expect(pxPerWorldMm(t)).toBeCloseTo(CSS_PX_PER_MM / 10, 12);
    expect(screenLengthToWorld(CSS_PX_PER_MM, t)).toBeCloseTo(10, 9);
  });

  it('zooming about an anchor keeps the point under the anchor fixed', () => {
    const anchor = vec(400, 300);
    const before = screenToPage(anchor, vp);
    const z = zoomAt(vp, 5, anchor);
    const after = screenToPage(anchor, z);
    expect(z.zoom).toBe(5);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('panning moves the screen origin only', () => {
    expect(panBy(vp, 10, -5)).toEqual({ zoom: 2, originX: 110, originY: 695 });
  });
});
