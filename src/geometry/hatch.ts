import { vec, type Vec2 } from './vec';

/** Circle as a polygon (for filling/hatching). 256 sides: radial error < 0.0076 % of r. */
export function circlePolygon(c: Vec2, r: number, sides = 256): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (2 * Math.PI * i) / sides;
    return vec(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  });
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Parallel hatch lines clipped to a polygon (even-odd rule), at `angleDeg` and `spacing`.
 * Lines are anchored to the drawing origin (lines through k·spacing), so neighbouring
 * hatched areas line up. Returns null if more than `maxLines` lines would be needed.
 */
export function hatchLines(poly: readonly Vec2[], angleDeg: number, spacing: number, maxLines = 2000): [Vec2, Vec2][] | null {
  if (poly.length < 3 || !(spacing > 0)) return [];
  const t = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  // Rotate into a frame where the hatch lines are horizontal: (u, v) = R(-t)·p.
  const toU = (p: Vec2) => vec(p.x * cos + p.y * sin, -p.x * sin + p.y * cos);
  const back = (u: number, v: number) => vec(u * cos - v * sin, u * sin + v * cos);
  const q = poly.map(toU);
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of q) {
    vMin = Math.min(vMin, p.y);
    vMax = Math.max(vMax, p.y);
  }
  const k0 = Math.ceil(vMin / spacing);
  const k1 = Math.floor(vMax / spacing);
  if (k1 - k0 + 1 > maxLines) return null;
  const out: [Vec2, Vec2][] = [];
  for (let k = k0; k <= k1; k++) {
    const v = k * spacing;
    const xs: number[] = [];
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const b = q[(i + 1) % q.length];
      // half-open rule so a vertex on the scan line is counted once
      if (a.y > v !== b.y > v) xs.push(a.x + ((v - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-12) out.push([back(xs[i], v), back(xs[i + 1], v)]);
  }
  return out;
}
