import { memo } from 'react';
import type { ViewTransform } from '../geometry/coords';
import { pageToScreen, pxPerPageMm } from '../geometry/viewport';
import { titleBlockLayout } from '../model/titleBlock';
import type { DrawingDocument } from '../model/types';

/** Drawing frame + title block, drawn in PAPER millimetres (part of the sheet, not selectable). */
export const SheetView = memo(function SheetView({ doc, transform }: { doc: Pick<DrawingDocument, 'page' | 'scale' | 'titleBlock'>; transform: ViewTransform }) {
  const l = titleBlockLayout(doc);
  if (!l) return null;
  const vp = transform.viewport;
  const k = pxPerPageMm(vp);
  const S = (p: { x: number; y: number }) => pageToScreen(p, vp);
  return (
    <g className="sheet" data-testid="title-block" pointerEvents="none">
      {l.lines.map(([a, b], i) => {
        const p = S(a);
        const q = S(b);
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#000" strokeWidth={Math.max(0.5, (i < 4 ? l.frameWeight : l.gridWeight) * k)} />;
      })}
      {k * 1.8 >= 3 &&
        l.texts.map((t, i) => {
          const p = S(t.pos);
          return (
            <text key={`t${i}`} x={p.x} y={p.y} fontSize={t.height * k} fill={t.kind === 'label' ? '#5f6368' : '#000'} className="sheet-text" data-field={t.kind}>
              {t.text}
            </text>
          );
        })}
    </g>
  );
});
