import { memo } from 'react';
import { pxPerWorldMm, worldToScreen, type ViewTransform } from '../geometry/coords';
import { pxPerPageMm } from '../geometry/viewport';
import { vec, type Vec2 } from '../geometry/vec';
import { layoutDimension, type DimensionLayout } from '../model/dimensions';
import type { ArrowheadStyle, Dimension, DrawingDocument } from '../model/types';

const DIM_LINE_PAPER_MM = 0.18;

/** SVG for one arrowhead, in screen space. dirDeg is the world direction the arrow points. */
function Arrow({ tip, dirDeg, size, style, color, strokeWidth }: { tip: Vec2; dirDeg: number; size: number; style: ArrowheadStyle; color: string; strokeWidth: number }) {
  // Screen Y is flipped: world angle a → screen direction (cos a, -sin a).
  const a = (dirDeg * Math.PI) / 180;
  const d = vec(Math.cos(a), -Math.sin(a));
  const n = vec(-d.y, d.x);
  const back = vec(tip.x - d.x * size, tip.y - d.y * size);
  const w = size / 6;
  switch (style) {
    case 'closed':
      return <polygon points={`${tip.x},${tip.y} ${back.x + n.x * w},${back.y + n.y * w} ${back.x - n.x * w},${back.y - n.y * w}`} fill={color} stroke="none" />;
    case 'open':
      return (
        <polyline
          points={`${back.x + n.x * w * 1.5},${back.y + n.y * w * 1.5} ${tip.x},${tip.y} ${back.x - n.x * w * 1.5},${back.y - n.y * w * 1.5}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
        />
      );
    case 'tick': {
      const t = vec((d.x + n.x) * 0.5 * size * 0.7, (d.y + n.y) * 0.5 * size * 0.7);
      return <line x1={tip.x - t.x} y1={tip.y - t.y} x2={tip.x + t.x} y2={tip.y + t.y} stroke={color} strokeWidth={strokeWidth * 2.5} />;
    }
    case 'dot':
      return <circle cx={tip.x} cy={tip.y} r={size / 5} fill={color} />;
    case 'none':
      return null;
  }
}

function arcPath(t: ViewTransform, c: Vec2, r: number, startDeg: number, sweepDeg: number): string {
  const p = (deg: number) => worldToScreen(vec(c.x + r * Math.cos((deg * Math.PI) / 180), c.y + r * Math.sin((deg * Math.PI) / 180)), t);
  const a = p(startDeg);
  const b = p(startDeg + sweepDeg);
  const rp = r * pxPerWorldMm(t);
  // World CCW appears CCW on screen after the Y flip → SVG sweep-flag 0.
  return `M ${a.x} ${a.y} A ${rp} ${rp} 0 ${sweepDeg > 180 ? 1 : 0} 0 ${b.x} ${b.y}`;
}

export function DimensionLayoutView({ layout, arrowhead, transform, color, testId, kind }: { layout: DimensionLayout; arrowhead: ArrowheadStyle; transform: ViewTransform; color: string; testId?: string; kind?: string }) {
  const S = (p: Vec2) => worldToScreen(p, transform);
  const k = pxPerWorldMm(transform);
  const sw = Math.max(0.6, DIM_LINE_PAPER_MM * pxPerPageMm(transform.viewport));
  const tp = S(layout.textPos);
  const fontPx = layout.textHeight * k;
  return (
    <g className="dimension" data-dimension-id={testId} data-kind={kind} data-value={layout.value}>
      {layout.lines.map(([a, b], i) => {
        const p = S(a);
        const q = S(b);
        return <line key={`l${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeWidth={sw} />;
      })}
      {layout.arcs.map((arc, i) => (
        <path key={`a${i}`} d={arcPath(transform, arc.center, arc.radius, arc.startDeg, arc.sweepDeg)} fill="none" stroke={color} strokeWidth={sw} />
      ))}
      {layout.arrows.map((ar, i) => (
        <Arrow key={`h${i}`} tip={S(ar.tip)} dirDeg={ar.dirDeg} size={layout.arrowSize * k} style={arrowhead} color={color} strokeWidth={sw} />
      ))}
      {fontPx >= 2 && (
        <text
          x={tp.x}
          y={tp.y}
          fontSize={fontPx}
          fill={color}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${-layout.textRotationDeg} ${tp.x} ${tp.y})`}
          className="dimension-text"
          data-testid="dimension-text"
        >
          {layout.text}
        </text>
      )}
    </g>
  );
}

/** Renders a dimension of the document (recomputed from linked geometry every render). */
export const DimensionView = memo(function DimensionView({
  dim,
  doc,
  transform,
  highlight,
}: {
  dim: Dimension;
  doc: Pick<DrawingDocument, 'shapes' | 'scale'>;
  transform: ViewTransform;
  highlight?: string;
}) {
  const layout = layoutDimension(doc, dim, doc.scale);
  if (!layout) return null;
  return (
    <DimensionLayoutView
      layout={layout}
      arrowhead={dim.style.arrowhead}
      transform={transform}
      color={highlight ?? dim.style.color}
      testId={dim.id}
      kind={dim.kind}
    />
  );
});
