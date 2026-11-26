import { boundsContains, type Bounds } from '../geometry/bounds';
import { distance, distanceToSegment, type Vec2 } from '../geometry/vec';
import { rectCorners, shapeBounds } from './shapes';
import type { Shape, ShapeId } from './types';

/** Distance (world mm) from p to the outline of a shape. */
export function distanceToShape(s: Shape, p: Vec2): number {
  switch (s.kind) {
    case 'line':
      return distanceToSegment(p, s.start, s.end);
    case 'rect': {
      const c = rectCorners(s);
      return Math.min(...c.map((a, i) => distanceToSegment(p, a, c[(i + 1) % 4])));
    }
    case 'circle':
      return Math.abs(distance(p, s.center) - s.radius);
    case 'polyline': {
      if (s.points.length === 1) return distance(p, s.points[0]);
      let d = Infinity;
      for (let i = 1; i < s.points.length; i++) d = Math.min(d, distanceToSegment(p, s.points[i - 1], s.points[i]));
      return d;
    }
  }
}

/** Topmost shape whose outline is within tolerance (world mm) of p. */
export function hitTest(shapes: readonly Shape[], p: Vec2, tolerance: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (distanceToShape(shapes[i], p) <= tolerance) return shapes[i];
  }
  return null;
}

/** IDs of shapes lying completely inside a selection window. */
export function shapesInsideBounds(shapes: readonly Shape[], window: Bounds): ShapeId[] {
  return shapes.filter((s) => boundsContains(window, shapeBounds(s))).map((s) => s.id);
}
