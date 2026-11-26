import { describe, expect, it } from 'vitest';
import { A3_LANDSCAPE, CSS_PX_PER_MM, pageAspectRatio } from '../src/geometry/page';
import { createEmptyDocument } from '../src/model/document';
import { fitPage, pageToScreen, pxPerPageMm } from '../src/geometry/viewport';
import { vec } from '../src/geometry/vec';

describe('A3 page', () => {
  it('is 420 mm wide and 297 mm high (landscape)', () => {
    expect(A3_LANDSCAPE.widthMm).toBe(420);
    expect(A3_LANDSCAPE.heightMm).toBe(297);
  });

  it('new documents use the A3 landscape sheet', () => {
    const doc = createEmptyDocument();
    expect(doc.page).toEqual({ widthMm: 420, heightMm: 297 });
    expect(doc.shapes).toHaveLength(0);
  });

  it('has the ISO 216 aspect ratio (√2)', () => {
    expect(pageAspectRatio(A3_LANDSCAPE)).toBeCloseTo(Math.SQRT2, 2);
  });

  it('100 % zoom is true size at 96 dpi', () => {
    expect(CSS_PX_PER_MM).toBeCloseTo(96 / 25.4, 12);
    expect(pxPerPageMm({ zoom: 1, originX: 0, originY: 0 })).toBeCloseTo(3.7795275591, 9);
  });

  it.each([0.1, 0.25, 1, 3.7, 20])('keeps exact page proportions at zoom %s', (zoom) => {
    const vp = { zoom, originX: 17, originY: 900 };
    const bl = pageToScreen(vec(0, 0), vp);
    const tr = pageToScreen(vec(420, 297), vp);
    const w = tr.x - bl.x;
    const h = bl.y - tr.y;
    expect(w / h).toBeCloseTo(420 / 297, 10);
    expect(w).toBeCloseTo(420 * zoom * CSS_PX_PER_MM, 9);
  });

  it('fit page centres the whole sheet inside the available area', () => {
    const vp = fitPage(A3_LANDSCAPE, 1000, 600, 20);
    const bl = pageToScreen(vec(0, 0), vp);
    const tr = pageToScreen(vec(420, 297), vp);
    expect(bl.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(tr.y).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(tr.x).toBeLessThanOrEqual(980 + 1e-9);
    expect(bl.y).toBeLessThanOrEqual(580 + 1e-9);
    // centred
    expect((bl.x + tr.x) / 2).toBeCloseTo(500, 9);
    expect((bl.y + tr.y) / 2).toBeCloseTo(300, 9);
    // height-limited here: sheet fills the available height exactly
    expect(bl.y - tr.y).toBeCloseTo(560, 9);
  });
});
