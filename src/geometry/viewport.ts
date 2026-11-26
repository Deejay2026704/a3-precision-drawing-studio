import { CSS_PX_PER_MM, type PageSize } from './page';
import { vec, type Vec2 } from './vec';

/**
 * Maps page (paper) millimetres to screen pixels.
 * `originX/originY` = screen position (px) of the page's bottom-left corner.
 * `zoom` = 1 means true paper size at 96 dpi. The same factor is used for
 * X and Y so the page proportions are exact at every zoom level.
 */
export interface Viewport {
  readonly zoom: number;
  readonly originX: number;
  readonly originY: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 50;
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8] as const;

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Screen pixels per paper millimetre. */
export const pxPerPageMm = (vp: Viewport): number => vp.zoom * CSS_PX_PER_MM;

export function pageToScreen(p: Vec2, vp: Viewport): Vec2 {
  const k = pxPerPageMm(vp);
  return vec(vp.originX + p.x * k, vp.originY - p.y * k);
}

export function screenToPage(p: Vec2, vp: Viewport): Vec2 {
  const k = pxPerPageMm(vp);
  return vec((p.x - vp.originX) / k, (vp.originY - p.y) / k);
}

/** Zoom to newZoom while keeping the page point under `anchor` (screen px) fixed. */
export function zoomAt(vp: Viewport, newZoom: number, anchor: Vec2): Viewport {
  const z = clampZoom(newZoom);
  const pagePt = screenToPage(anchor, vp);
  const k = z * CSS_PX_PER_MM;
  return { zoom: z, originX: anchor.x - pagePt.x * k, originY: anchor.y + pagePt.y * k };
}

export const panBy = (vp: Viewport, dx: number, dy: number): Viewport => ({
  ...vp,
  originX: vp.originX + dx,
  originY: vp.originY + dy,
});

/** Viewport that fits the whole page, centred, inside a screen area of the given size. */
export function fitPage(page: PageSize, screenWidth: number, screenHeight: number, marginPx = 24): Viewport {
  const availW = Math.max(1, screenWidth - 2 * marginPx);
  const availH = Math.max(1, screenHeight - 2 * marginPx);
  const zoom = clampZoom(Math.min(availW / page.widthMm, availH / page.heightMm) / CSS_PX_PER_MM);
  const k = zoom * CSS_PX_PER_MM;
  const w = page.widthMm * k;
  const h = page.heightMm * k;
  return { zoom, originX: (screenWidth - w) / 2, originY: (screenHeight + h) / 2 };
}

/** Viewport at a given zoom with the page centred. */
export function centredAtZoom(page: PageSize, screenWidth: number, screenHeight: number, zoom: number): Viewport {
  const z = clampZoom(zoom);
  const k = z * CSS_PX_PER_MM;
  return {
    zoom: z,
    originX: (screenWidth - page.widthMm * k) / 2,
    originY: (screenHeight + page.heightMm * k) / 2,
  };
}
