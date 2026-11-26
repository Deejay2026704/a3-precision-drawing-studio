import { memo, useMemo } from 'react';
import type { DrawingScale } from '../geometry/scale';
import { HATCH_WEIGHT_MM, hatchSegments } from '../model/fill';
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
  /** Resolved fill/hatch colour (By layer already applied); needed to draw the shape's fill. */
  fillColor?: string;
  /** Drawing scale (hatch spacing is in paper mm). */
  scale?: DrawingScale;
}

/** Renders one shape as vector SVG, converting world mm → screen px. Never mutates geometry. */
export const ShapeView = memo(function ShapeView({ shape, transform, stroke, dashed, fillColor, scale }: Props) {
  const fill = fillColor && scale ? shape.style.fill : undefined;
  const hatch = useMemo(() => (fill && scale && fill.pattern !== 'solid' ? hatchSegments(shape, fill, scale) : null), [shape, fill, scale]);
  const outline = <Outline shape={shape} transform={transform} stroke={stroke} dashed={dashed} solid={fill?.pattern === 'solid' ? fillColor : undefined} />;
  if (!fill || !fillColor) return outline;
  const S = (p: { x: number; y: number }) => worldToScreen(p, transform);
  const w = Math.max(MIN_STROKE_PX, HATCH_WEIGHT_MM * pxPerPageMm(transform.viewport));
  return (
    <g data-fill={fill.pattern} data-fill-of={shape.id}>
      {hatch && (
        <g className="hatch" stroke={fillColor} strokeWidth={w} pointerEvents="none">
          {hatch.map(([a, b], i) => {
            const p = S(a);
            const q = S(b);
            return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
          })}
        </g>
      )}
      {outline}
    </g>
  );
});

const Outline = memo(function Outline({ shape, transform, stroke, dashed, solid }: { shape: Shape; transform: ViewTransform; stroke?: string; dashed?: boolean; solid?: string }) {
  const strokeWidth = Math.max(MIN_STROKE_PX, shape.style.strokeWidthMm * pxPerPageMm(transform.viewport));
  const common = {
    fill: solid ?? 'none',
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
