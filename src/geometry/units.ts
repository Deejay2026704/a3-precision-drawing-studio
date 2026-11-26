/** Formatting and parsing of millimetre values for display and entry. */

export const DISPLAY_DECIMALS = 3;

/** Round to the given number of decimals, removing -0. */
export function roundTo(value: number, decimals = DISPLAY_DECIMALS): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** e.g. 12.5 → "12.5", 100 → "100", 1/3 → "0.333". */
export function formatNumber(value: number, decimals = DISPLAY_DECIMALS): string {
  if (!Number.isFinite(value)) return '—';
  return String(roundTo(value, decimals));
}

export const formatMm = (value: number, decimals = DISPLAY_DECIMALS): string => `${formatNumber(value, decimals)} mm`;

/** Parse numeric user input. Accepts an optional trailing "mm" or "°" and a decimal comma. */
export function parseNumberInput(text: string): number | null {
  const t = text.trim().replace(/(mm|°|deg)$/i, '').trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Snap a value to the nearest multiple of step (no-op when step <= 0). */
export function snapValue(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}
