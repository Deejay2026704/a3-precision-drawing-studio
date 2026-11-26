import { memo } from 'react';
import { worldToScreen, type ViewTransform } from '../geometry/coords';
import { pxPerPageMm } from '../geometry/viewport';
import { pxPerWorldMm } from '../geometry/coords';
import { arcEnd, arcStart } from '../model/arcs';
import { rectCorners } from '../model/shapes';
import type { Shape } from '../model/types';

/** Minimum on-screen stroke so very thin pens remain visible when zoomed out (display only). */
const MIN_STROKE_PX = 0.5;

const pts = (points: readonly { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

interface Props {
  shape: Shape;
  transform: ViewTransform;
  /** Optional override, e.g. for previews. */
  stroke?: string;
  dashed?: boolean;
}

/** Renders one shape as vector SVG, converting world mm → screen px. Never mutates geometry. */
export const ShapeView = memo(function ShapeView({ shape, transform, stroke, dashed }: Props) {
  const strokeWidth = Math.max(MIN_STROKE_PX, shape.style.strokeWidthMm * pxPerPageMm(transform.viewport));
  const common = {
    fill: 'none',
    stroke: stroke ?? shape.style.stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dashed ? '6 4' : undefined,
    'data-shape-id': shape.id,
    'data-kind': shape.kind,
  };
  const S = (p: { x: number; y: number }) => worldToScreen(p, transform);
  switch (shape.kind) {
    case 'line': {
      const a = S(shape.start);
      const b = S(shape.end);
      return <line {...common} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
    }
    case 'rect':
      return <polygon {...common} points={pts(rectCorners(shape).map(S))} />;
    case 'circle': {
      const c = S(shape.center);
      return <circle {...common} cx={c.x} cy={c.y} r={shape.radius * pxPerWorldMm(transform)} />;
    }
    case 'arc': {
      const a = S(arcStart(shape));
      const b = S(arcEnd(shape));
      const rp = shape.radius * pxPerWorldMm(transform);
      // World CCW stays CCW on screen after the Y flip → SVG sweep-flag 0.
      return <path {...common} d={`M ${a.x} ${a.y} A ${rp} ${rp} 0 ${shape.sweepDeg > 180 ? 1 : 0} 0 ${b.x} ${b.y}`} />;
    }
    case 'polyline':
      return shape.closed ? <polygon {...common} points={pts(shape.points.map(S))} /> : <polyline {...common} points={pts(shape.points.map(S))} />;
  }
});
