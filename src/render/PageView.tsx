import type { ReactElement } from "react";
import { pxPerWorldMm, type ViewTransform } from '../geometry/coords';
import { pageLengthToWorld } from '../geometry/scale';
import type { PageSize } from '../geometry/page';
import { pageToScreen, pxPerPageMm } from '../geometry/viewport';
import { vec } from '../geometry/vec';

/** Spacing actually drawn: the configured spacing, multiplied by 5/10 until lines are ≥ 6 px apart. */
export function visibleGridStep(spacingWorldMm: number, pxPerWorld: number): number {
  let step = spacingWorldMm;
  for (let i = 0; i < 12 && step * pxPerWorld < 6; i++) step *= i % 2 === 0 ? 5 : 2;
  return step;
}

/** The white A3 sheet with its boundary and an optional grid (spacing in drawing mm). */
export function PageView({ page, transform, showGrid, gridSpacingMm }: { page: PageSize; transform: ViewTransform; showGrid: boolean; gridSpacingMm: number }) {
  const vp = transform.viewport;
  const tl = pageToScreen(vec(0, page.heightMm), vp);
  const k = pxPerPageMm(vp);
  const w = page.widthMm * k;
  const h = page.heightMm * k;
  const kw = pxPerWorldMm(transform);
  const worldW = pageLengthToWorld(page.widthMm, transform.scale);
  const worldH = pageLengthToWorld(page.heightMm, transform.scale);

  const grid: ReactElement[] = [];
  if (showGrid && gridSpacingMm > 0) {
    const step = visibleGridStep(gridSpacingMm, kw);
    const major = step * 5;
    const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
    for (let i = 1; i * step < worldW - 1e-9 && i < 2000; i++) {
      const sx = tl.x + i * step * kw;
      grid.push(<line key={`gx${i}`} x1={sx} y1={tl.y} x2={sx} y2={tl.y + h} className={isMajor(i * step) ? 'grid-major' : 'grid-minor'} />);
    }
    for (let i = 1; i * step < worldH - 1e-9 && i < 2000; i++) {
      const sy = tl.y + h - i * step * kw;
      grid.push(<line key={`gy${i}`} x1={tl.x} y1={sy} x2={tl.x + w} y2={sy} className={isMajor(i * step) ? 'grid-major' : 'grid-minor'} />);
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
