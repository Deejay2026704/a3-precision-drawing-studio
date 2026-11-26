import { mul, type Vec2 } from './vec';

/**
 * Drawing scale expressed as paper : real, e.g. 1:50 means 1 mm on paper
 * represents 50 mm in the real world. Enlargements such as 2:1 are allowed.
 */
export interface DrawingScale {
  readonly paper: number;
  readonly real: number;
}

export const STANDARD_SCALES: readonly DrawingScale[] = Object.freeze(
  [1, 2, 5, 10, 20, 50, 100].map((real) => Object.freeze({ paper: 1, real })),
);

export const SCALE_1_1: DrawingScale = STANDARD_SCALES[0];

export function isValidScale(s: DrawingScale): boolean {
  return Number.isFinite(s.paper) && Number.isFinite(s.real) && s.paper > 0 && s.real > 0;
}

/** Paper millimetres per real-world millimetre. */
export function scaleFactor(s: DrawingScale): number {
  if (!isValidScale(s)) throw new RangeError(`Invalid drawing scale ${s.paper}:${s.real}`);
  return s.paper / s.real;
}

export const worldLengthToPage = (lengthMm: number, s: DrawingScale): number => lengthMm * scaleFactor(s);
export const pageLengthToWorld = (lengthMm: number, s: DrawingScale): number => lengthMm / scaleFactor(s);

/** Drawing (world) coordinates → page (paper) coordinates. Both share the bottom-left origin. */
export const worldToPage = (p: Vec2, s: DrawingScale): Vec2 => mul(p, scaleFactor(s));
/** Page (paper) coordinates → drawing (world) coordinates. */
export const pageToWorld = (p: Vec2, s: DrawingScale): Vec2 => mul(p, 1 / scaleFactor(s));

export const scalesEqual = (a: DrawingScale, b: DrawingScale): boolean =>
  Math.abs(a.paper / a.real - b.paper / b.real) < 1e-12;

function formatScaleNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

export const formatScale = (s: DrawingScale): string => `${formatScaleNumber(s.paper)}:${formatScaleNumber(s.real)}`;

/**
 * Parse user input such as "1:25", "1/25", "2:1" or "25" (shorthand for 1:25).
 * Returns null when the text is not a valid positive scale.
 */
export function parseScale(text: string): DrawingScale | null {
  const t = text.trim();
  const m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(t);
  let s: DrawingScale | null = null;
  if (m) s = { paper: Number(m[1]), real: Number(m[2]) };
  else if (/^\d+(?:\.\d+)?$/.test(t)) s = { paper: 1, real: Number(t) };
  return s && isValidScale(s) ? s : null;
}
