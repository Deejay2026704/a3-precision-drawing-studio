import { worldToScreen, type ViewTransform } from '../geometry/coords';
import type { SelectionFrame } from '../model/handles';

export const HANDLE_SIZE_PX = 8;
export const ROTATE_HANDLE_OFFSET_PX = 28;

/** Selection outline + handles, drawn in screen space at a constant pixel size. */
export function SelectionOverlay({ frame, transform, interactive }: { frame: SelectionFrame; transform: ViewTransform; interactive: boolean }) {
  const S = (p: { x: number; y: number }) => worldToScreen(p, transform);
  const outline = frame.outline.map(S);
  const rotate = frame.handles.find((h) => h.id === 'rotate');
  const half = HANDLE_SIZE_PX / 2;
  return (
    <g className="selection" pointerEvents="none" data-testid="selection-overlay">
      {frame.mode === 'line' ? null : (
        <polygon points={outline.map((p) => `${p.x},${p.y}`).join(' ')} className="selection-outline" />
      )}
      {interactive &&
        rotate &&
        (() => {
          const r = S(rotate.position);
          const n = frame.handles.find((h) => h.id === 'n');
          const anchor = n ? S(n.position) : frame.mode === 'line' ? S(frame.pivot) : null;
          return (
            <>
              {anchor && <line x1={anchor.x} y1={anchor.y} x2={r.x} y2={r.y} className="selection-outline" />}
              <circle cx={r.x} cy={r.y} r={half + 1} className="handle handle-rotate" data-handle="rotate" />
            </>
          );
        })()}
      {interactive &&
        frame.handles
          .filter((h) => h.id !== 'rotate')
          .map((h) => {
            const p = S(h.position);
            return <rect key={h.id} x={p.x - half} y={p.y - half} width={HANDLE_SIZE_PX} height={HANDLE_SIZE_PX} className="handle" data-handle={h.id} />;
          })}
    </g>
  );
}
