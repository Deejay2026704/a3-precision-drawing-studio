/**
 * Physical paper definitions. All values in paper millimetres.
 */
export interface PageSize {
  readonly widthMm: number;
  readonly heightMm: number;
}

/** ISO 216 A3 portrait is 297 × 420 mm; the application uses A3 landscape. */
export const A3_LANDSCAPE: PageSize = Object.freeze({ widthMm: 420, heightMm: 297 });

export const MM_PER_INCH = 25.4;
/** CSS reference pixel density used by Chromium/Electron. */
export const CSS_PX_PER_INCH = 96;
/** CSS pixels per paper millimetre at 100 % zoom (true size on a 96 dpi display). */
export const CSS_PX_PER_MM = CSS_PX_PER_INCH / MM_PER_INCH;

export const pageAspectRatio = (page: PageSize): number => page.widthMm / page.heightMm;
