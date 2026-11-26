import { describe, expect, it } from 'vitest';
import { visibleGridStep } from '../src/render/PageView';
import { snapToGrid } from '../src/model/snap';
import { vec } from '../src/geometry/vec';

describe('grid spacing and grid snap', () => {
  it('uses the configured spacing (drawing mm) when it is visible', () => {
    expect(visibleGridStep(10, 2)).toBe(10); // 20 px apart
  });
  it('coarsens a dense grid by 5 / 10 steps so lines stay ≥ 6 px apart', () => {
    expect(visibleGridStep(10, 0.2)).toBe(50); // 10 px
    expect(visibleGridStep(1, 0.04)).toBe(500); // 1→5→10→50→100→500: 20 px
    expect(visibleGridStep(10, 0.2) * 0.2).toBeGreaterThanOrEqual(6);
  });
  it('grid snap rounds to the increment in drawing mm, including negatives', () => {
    expect(snapToGrid(vec(12.4, -7.6), 5)).toEqual(vec(10, -10));
    expect(snapToGrid(vec(0.26, 0.24), 0.5)).toEqual(vec(0.5, 0));
  });
});
