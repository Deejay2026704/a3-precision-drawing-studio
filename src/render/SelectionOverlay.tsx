import { worldToScreen, type ViewTransform } from '../geometry/coords';
import { isGrip, type SelectionFrame } from '../model/handles';
import type { Vec2 } from '../geometry/vec';

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
            return (
              <rect
                key={h.id}
                x={p.x - half}
                y={p.y - half}
                width={HANDLE_SIZE_PX}
                height={HANDLE_SIZE_PX}
                className={isGrip(h.id) ? 'handle grip' : 'handle'}
                data-handle={h.id}
              >
                <title>{isGrip(h.id) ? (h.id === 'move' ? 'Centre grip: drag to move (snaps)' : 'Endpoint grip: drag to move this point (snaps)') : 'Resize handle'}</title>
              </rect>
            );
          })}
    </g>
  );
}

/** Grips of a selected dimension (placement only; the measured value cannot be dragged). */
export function DimensionGrips({ grips, transform }: { grips: readonly { id: string; position: Vec2 }[]; transform: ViewTransform }) {
  const half = HANDLE_SIZE_PX / 2;
  return (
    <g pointerEvents="none" data-testid="dimension-grips">
      {grips.map((g) => {
        const p = worldToScreen(g.position, transform);
        return <rect key={g.id} x={p.x - half} y={p.y - half} width={HANDLE_SIZE_PX} height={HANDLE_SIZE_PX} className="handle grip dim-grip" data-dim-grip={g.id} />;
      })}
    </g>
  );
}
