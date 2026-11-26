import { formatNumber } from '../geometry/units';
import { pxPerWorldMm, screenToWorld, worldToScreen, type ViewTransform } from '../geometry/coords';
import { vec } from '../geometry/vec';
import { rulerTicks } from './rulerTicks';

export const RULER_SIZE = 24;
/** Approximate label width in px (10 px font) – used to avoid drawing clipped labels. */
const labelWidth = (text: string) => text.length * 6 + 4;

/** Horizontal ruler showing drawing X in millimetres. */
export function HorizontalRuler({ transform, width, cursorX }: { transform: ViewTransform; width: number; cursorX: number | null }) {
  const k = pxPerWorldMm(transform);
  const from = screenToWorld(vec(0, 0), transform).x;
  const to = screenToWorld(vec(width, 0), transform).x;
  const ticks = rulerTicks(from, to, k);
  return (
    <svg className="ruler ruler-h" width={width} height={RULER_SIZE} data-testid="ruler-horizontal">
      {ticks.map((t) => {
        const x = worldToScreen(vec(t.value, 0), transform).x;
        return (
          <g key={t.value}>
            <line x1={x} y1={t.major ? 0 : RULER_SIZE - 6} x2={x} y2={RULER_SIZE} className="ruler-tick" />
            {t.major && x >= 0 && x + labelWidth(formatNumber(t.value)) <= width && (
              <text x={x + 3} y={11} className="ruler-label">
                {formatNumber(t.value)}
              </text>
            )}
          </g>
        );
      })}
      {cursorX !== null && <line x1={cursorX} y1={0} x2={cursorX} y2={RULER_SIZE} className="ruler-cursor" />}
    </svg>
  );
}

/** Vertical ruler showing drawing Y in millimetres (increasing upwards). */
export function VerticalRuler({ transform, height, cursorY }: { transform: ViewTransform; height: number; cursorY: number | null }) {
  const k = pxPerWorldMm(transform);
  const from = screenToWorld(vec(0, height), transform).y;
  const to = screenToWorld(vec(0, 0), transform).y;
  const ticks = rulerTicks(from, to, k);
  return (
    <svg className="ruler ruler-v" width={RULER_SIZE} height={height} data-testid="ruler-vertical">
      {ticks.map((t) => {
        const y = worldToScreen(vec(0, t.value), transform).y;
        return (
          <g key={t.value}>
            <line x1={t.major ? 0 : RULER_SIZE - 6} y1={y} x2={RULER_SIZE} y2={y} className="ruler-tick" />
            {t.major && y <= height && y - labelWidth(formatNumber(t.value)) >= 0 && (
              <text x={11} y={y - 3} className="ruler-label" transform={`rotate(-90 11 ${y - 3})`}>
                {formatNumber(t.value)}
              </text>
            )}
          </g>
        );
      })}
      {cursorY !== null && <line x1={0} y1={cursorY} x2={RULER_SIZE} y2={cursorY} className="ruler-cursor" />}
    </svg>
  );
}
