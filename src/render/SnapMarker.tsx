import { worldToScreen, type ViewTransform } from '../geometry/coords';
import { SNAP_LABELS, type SnapResult } from '../model/snap';

/** AutoCAD-style snap glyph at the snapped point, plus a label naming the snap. */
export function SnapMarker({ snap, transform }: { snap: SnapResult; transform: ViewTransform }) {
  const p = worldToScreen(snap.point, transform);
  const s = 6;
  const { x, y } = p;
  let glyph;
  switch (snap.kind) {
    case 'endpoint':
      glyph = <rect x={x - s} y={y - s} width={2 * s} height={2 * s} />;
      break;
    case 'midpoint':
      glyph = <polygon points={`${x},${y - s - 1} ${x + s + 1},${y + s} ${x - s - 1},${y + s}`} />;
      break;
    case 'center':
      glyph = <circle cx={x} cy={y} r={s} />;
      break;
    case 'intersection':
      glyph = <path d={`M ${x - s} ${y - s} L ${x + s} ${y + s} M ${x + s} ${y - s} L ${x - s} ${y + s}`} />;
      break;
    case 'perpendicular':
      glyph = <path d={`M ${x - s} ${y - s} L ${x - s} ${y + s} L ${x + s} ${y + s} M ${x - s} ${y} L ${x} ${y} L ${x} ${y + s}`} />;
      break;
    case 'tangent':
      glyph = (
        <>
          <circle cx={x} cy={y + 1} r={s - 1} />
          <line x1={x - s - 2} y1={y - s} x2={x + s + 2} y2={y - s} />
        </>
      );
      break;
    case 'nearest':
      glyph = <path d={`M ${x - s} ${y - s} L ${x + s} ${y - s} L ${x - s} ${y + s} L ${x + s} ${y + s} Z`} />;
      break;
    case 'grid':
      glyph = <path d={`M ${x - 4} ${y} L ${x + 4} ${y} M ${x} ${y - 4} L ${x} ${y + 4}`} />;
      break;
  }
  return (
    <g className={`snap-marker snap-${snap.kind}`} pointerEvents="none" data-testid="snap-marker" data-snap-kind={snap.kind}>
      {glyph}
      {snap.kind !== 'grid' && (
        <text x={x + 10} y={y - 10} className="snap-label">
          {SNAP_LABELS[snap.kind]}
        </text>
      )}
    </g>
  );
}

/** Live measurement readout shown next to the cursor. */
export function CursorFeedback({ text, x, y }: { text: string; x: number; y: number }) {
  const w = text.length * 6.6 + 12;
  return (
    <g pointerEvents="none" className="cursor-feedback" data-testid="cursor-feedback">
      <rect x={x + 16} y={y + 14} width={w} height={20} rx={3} />
      <text x={x + 22} y={y + 28}>
        {text}
      </text>
    </g>
  );
}
