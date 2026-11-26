import { scaleFactor, type DrawingScale } from '../geometry/scale';
import { circlePolygon, hatchLines } from '../geometry/hatch';
import type { Vec2 } from '../geometry/vec';
import { rectCorners } from './shapes';
import type { FillStyle, Shape } from './types';

/** Shapes that enclose an area: rectangles, circles and closed polylines (3+ points). */
export const isFillable = (s: Shape): boolean =>
  s.kind === 'rect' || s.kind === 'circle' || (s.kind === 'polyline' && !!s.closed && s.points.length >= 3);

/** The enclosed area as a polygon in drawing mm (circles approximated with 256 sides), or null. */
export function fillOutline(s: Shape): Vec2[] | null {
  switch (s.kind) {
    case 'rect':
      return rectCorners(s);
    case 'circle':
      return circlePolygon(s.center, s.radius);
    case 'polyline':
      return isFillable(s) ? [...s.points] : null;
    default:
      return null;
  }
}

/** Hatch lines must not be closer than this on paper, or be more than this many per direction. */
export const MIN_HATCH_SPACING_MM = 0.5;
export const MAX_HATCH_LINES = 2000;
/** Line weight of hatch lines on paper. */
export const HATCH_WEIGHT_MM = 0.18;

/**
 * Hatch lines of a shape in drawing mm. Spacing is given in PAPER mm (like text heights),
 * so the hatch looks the same at any drawing scale. Returns null when too dense.
 */
export function hatchSegments(s: Shape, fill: FillStyle, scale: DrawingScale): [Vec2, Vec2][] | null {
  if (fill.pattern === 'solid') return [];
  const outline = fillOutline(s);
  if (!outline) return [];
  const spacing = Math.max(MIN_HATCH_SPACING_MM, fill.spacingMm) / scaleFactor(scale);
  const a = hatchLines(outline, fill.angleDeg, spacing, MAX_HATCH_LINES);
  if (!a) return null;
  if (fill.pattern !== 'crosshatch') return a;
  const b = hatchLines(outline, fill.angleDeg + 90, spacing, MAX_HATCH_LINES);
  return b ? [...a, ...b] : null;
}
