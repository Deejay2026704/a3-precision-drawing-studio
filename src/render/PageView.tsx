import type { ReactElement } from "react";
import type { ViewTransform } from '../geometry/coords';
import type { PageSize } from '../geometry/page';
import { pageToScreen, pxPerPageMm } from '../geometry/viewport';
import { vec } from '../geometry/vec';

/** The white A3 sheet with its boundary and an optional 10 mm (paper) grid. */
export function PageView({ page, transform, showGrid }: { page: PageSize; transform: ViewTransform; showGrid: boolean }) {
  const vp = transform.viewport;
  const tl = pageToScreen(vec(0, page.heightMm), vp);
  const k = pxPerPageMm(vp);
  const w = page.widthMm * k;
  const h = page.heightMm * k;

  const grid: ReactElement[] = [];
  if (showGrid) {
    const step = k * 10 >= 6 ? 10 : 50; // paper mm
    for (let x = step; x < page.widthMm; x += step) {
      const sx = tl.x + x * k;
      grid.push(<line key={`gx${x}`} x1={sx} y1={tl.y} x2={sx} y2={tl.y + h} className={x % 50 === 0 ? 'grid-major' : 'grid-minor'} />);
    }
    for (let y = step; y < page.heightMm; y += step) {
      const sy = tl.y + h - y * k;
      grid.push(<line key={`gy${y}`} x1={tl.x} y1={sy} x2={tl.x + w} y2={sy} className={y % 50 === 0 ? 'grid-major' : 'grid-minor'} />);
    }
  }

  return (
    <g data-testid="page">
      <rect x={tl.x + 3} y={tl.y + 3} width={w} height={h} fill="rgba(0,0,0,0.35)" />
      <rect
        x={tl.x}
        y={tl.y}
        width={w}
        height={h}
        fill="#ffffff"
        data-testid="page-sheet"
        data-width-mm={page.widthMm}
        data-height-mm={page.heightMm}
      />
      <g className="grid">{grid}</g>
      <rect x={tl.x} y={tl.y} width={w} height={h} fill="none" stroke="#3a3a3a" strokeWidth={1} data-testid="page-boundary" />
    </g>
  );
}
