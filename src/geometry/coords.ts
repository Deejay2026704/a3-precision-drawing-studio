import { pageToWorld, scaleFactor, worldToPage, type DrawingScale } from './scale';
import { pageToScreen, pxPerPageMm, screenToPage, type Viewport } from './viewport';
import type { Vec2 } from './vec';

/**
 * Complete transformation chain:
 *   drawing (world mm, Y up) --scale--> page (paper mm, Y up) --viewport--> screen (px, Y down)
 */
export interface ViewTransform {
  readonly scale: DrawingScale;
  readonly viewport: Viewport;
}

export const worldToScreen = (p: Vec2, t: ViewTransform): Vec2 => pageToScreen(worldToPage(p, t.scale), t.viewport);
export const screenToWorld = (p: Vec2, t: ViewTransform): Vec2 => pageToWorld(screenToPage(p, t.viewport), t.scale);

/** Screen pixels per world millimetre. */
export const pxPerWorldMm = (t: ViewTransform): number => pxPerPageMm(t.viewport) * scaleFactor(t.scale);

/** Convert a screen distance (px) into world millimetres, e.g. for hit tolerances. */
export const screenLengthToWorld = (px: number, t: ViewTransform): number => px / pxPerWorldMm(t);
