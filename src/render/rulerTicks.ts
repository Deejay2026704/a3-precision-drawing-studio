/**
 * Ruler tick computation (pure). Values are drawing (world) millimetres.
 */
export interface RulerTick {
  readonly value: number;
  readonly major: boolean;
}

/** Smallest "nice" step (1, 2, 5 × 10^n) whose on-screen spacing is at least minPx. */
export function niceStep(pxPerUnit: number, minPx: number): number {
  const raw = minPx / pxPerUnit;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

/**
 * Ticks for the visible range [from, to] (world mm).
 * Major ticks are labelled; there are 5 or 10 minor divisions per major step.
 */
export function rulerTicks(from: number, to: number, pxPerUnit: number, minMajorPx = 60): RulerTick[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const major = niceStep(pxPerUnit, minMajorPx);
  const lead = Math.round(major / 10 ** Math.floor(Math.log10(major)));
  const divisions = lead === 2 ? 4 : lead === 5 ? 5 : 10;
  let minor = major / divisions;
  if (minor * pxPerUnit < 4) minor = major / 2;
  const ticks: RulerTick[] = [];
  const start = Math.floor(lo / minor);
  const end = Math.ceil(hi / minor);
  if (end - start > 5000) return ticks;
  for (let i = start; i <= end; i++) {
    const value = i * minor;
    const ratio = value / major;
    ticks.push({ value: Number(value.toPrecision(12)), major: Math.abs(ratio - Math.round(ratio)) < 1e-6 });
  }
  return ticks;
}
