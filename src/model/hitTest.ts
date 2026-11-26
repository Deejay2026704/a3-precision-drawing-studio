import { boundsContains, type Bounds } from '../geometry/bounds';
import { distance, distanceToSegment, type Vec2 } from '../geometry/vec';
import { distanceToArc } from '../geometry/arc';
import { arcGeom } from './arcs';
import { pointInPolygon } from '../geometry/hatch';
import { fillOutline } from './fill';
import { polylineSegments, rectCorners, shapeBounds } from './shapes';
import type { Shape, ShapeId } from './types';

/** Distance (world mm) from p to the outline of a shape; 0 anywhere inside a FILLED shape. */
export function distanceToShape(s: Shape, p: Vec2): number {
  if (s.style.fill) {
    const outline = fillOutline(s);
    if (outline && pointInPolygon(p, outline)) return 0;
  }
  return distanceToOutline(s, p);
}

function distanceToOutline(s: Shape, p: Vec2): number {
  switch (s.kind) {
    case 'line':
      return distanceToSegment(p, s.start, s.end);
    case 'rect': {
      const c = rectCorners(s);
      return Math.min(...c.map((a, i) => distanceToSegment(p, a, c[(i + 1) % 4])));
    }
    case 'circle':
      return Math.abs(distance(p, s.center) - s.radius);
    case 'arc':
      return distanceToArc(arcGeom(s), p);
    case 'polyline': {
      if (s.points.length === 1) return distance(p, s.points[0]);
      let d = Infinity;
      for (const [a, b] of polylineSegments(s)) d = Math.min(d, distanceToSegment(p, a, b));
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
