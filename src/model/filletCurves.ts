import { normalizeAngle } from '../geometry/angles';
import { angleAt, angleOnArc } from '../geometry/arc';
import { add, distance, dot, length, mul, sub, vec, type Vec2 } from '../geometry/vec';
import { filletLines } from './curves';
import type { EditResult } from './modify';
import type { ArcShape, CircleShape, DrawingDocument, LineShape, Shape, ShapeId } from './types';

/**
 * Fillet involving circles and arcs (Milestone 6): line–arc, line–circle, arc–arc,
 * arc–circle and circle–circle. The fillet centre is where the two "offset by R" loci
 * meet (a line's parallels at ±R; a circle's concentric circles r+R and |r−R|); of all
 * solutions, the one whose tangent points are nearest the two picks is used.
 * Lines and arcs are trimmed/extended to the tangent points, keeping the picked side;
 * full circles are left whole (as in common CAD practice).
 */
type Ent = LineShape | CircleShape | ArcShape;
const fail = (message: string): EditResult => ({ ok: false, message });
const EPS = 1e-9;

type Locus = { type: 'line'; p: Vec2; d: Vec2 } | { type: 'circle'; c: Vec2; r: number };

function loci(e: Ent, R: number): Locus[] {
  if (e.kind === 'line') {
    const d0 = sub(e.end, e.start);
    const d = mul(d0, 1 / length(d0));
    const n = vec(-d.y, d.x);
    return [
      { type: 'line', p: add(e.start, mul(n, R)), d },
      { type: 'line', p: add(e.start, mul(n, -R)), d },
    ];
  }
  const out: Locus[] = [{ type: 'circle', c: e.center, r: e.radius + R }];
  if (Math.abs(e.radius - R) > EPS) out.push({ type: 'circle', c: e.center, r: Math.abs(e.radius - R) });
  return out;
}

function meet(a: Locus, b: Locus): Vec2[] {
  if (a.type === 'line' && b.type === 'line') return [];
  if (a.type === 'circle' && b.type === 'line') return meet(b, a);
  if (a.type === 'line' && b.type === 'circle') {
    const f = sub(a.p, b.c);
    const B = dot(f, a.d);
    const C = dot(f, f) - b.r * b.r;
    const disc = B * B - C;
    if (disc < -EPS) return [];
    const s = Math.sqrt(Math.max(0, disc));
    return (s < EPS ? [-B] : [-B - s, -B + s]).map((t) => add(a.p, mul(a.d, t)));
  }
  const A = a as Extract<Locus, { type: 'circle' }>;
  const Bc = b as Extract<Locus, { type: 'circle' }>;
  const d = distance(A.c, Bc.c);
  if (d < EPS || d > A.r + Bc.r + EPS || d < Math.abs(A.r - Bc.r) - EPS) return [];
  const x = (d * d + A.r * A.r - Bc.r * Bc.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, A.r * A.r - x * x));
  const u = mul(sub(Bc.c, A.c), 1 / d);
  const m = add(A.c, mul(u, x));
  const n = vec(-u.y, u.x);
  return h < EPS ? [m] : [add(m, mul(n, h)), add(m, mul(n, -h))];
}

/** Point where a fillet circle (C, R) touches the entity. */
function tangentPoint(e: Ent, C: Vec2, R: number): Vec2 {
  if (e.kind === 'line') {
    const d0 = sub(e.end, e.start);
    const t = dot(sub(C, e.start), d0) / dot(d0, d0);
    return add(e.start, mul(d0, t));
  }
  const v = sub(C, e.center);
  const dc = length(v);
  const u = mul(v, 1 / dc);
  // Fillet circle encloses this circle (R > r and centres closer than R): touches on the far side.
  return Math.abs(dc - (R - e.radius)) < 1e-6 && R > e.radius ? add(e.center, mul(u, -e.radius)) : add(e.center, mul(u, e.radius));
}

/** The entity trimmed/extended to T, keeping the picked side; null if nothing would remain. */
function trimTo(e: Ent, T: Vec2, pick: Vec2): Ent | null {
  if (e.kind === 'circle') return e;
  if (e.kind === 'line') {
    const d = sub(e.end, e.start);
    const L2 = dot(d, d);
    const t = dot(sub(T, e.start), d) / L2;
    const tp = dot(sub(pick, e.start), d) / L2;
    const out = tp >= t ? { ...e, start: T } : { ...e, end: T };
    return distance(out.start, out.end) > EPS ? out : null;
  }
  const g = { c: e.center, r: e.radius, startDeg: e.startDeg, sweepDeg: e.sweepDeg };
  const at = angleAt(e.center, T);
  const ap = angleAt(e.center, pick);
  const end = e.startDeg + e.sweepDeg;
  const opts: ArcShape[] = [
    { ...e, startDeg: normalizeAngle(at), sweepDeg: normalizeAngle(end - at) },
    { ...e, sweepDeg: normalizeAngle(at - e.startDeg) },
  ].filter((a) => a.sweepDeg > 1e-6 && a.sweepDeg < 360 - 1e-6 && angleOnArc({ ...g, startDeg: a.startDeg, sweepDeg: a.sweepDeg }, ap));
  if (opts.length === 0) return null;
  return opts.reduce((x, y) => (y.sweepDeg < x.sweepDeg ? y : x));
}

export function filletAny(doc: DrawingDocument, id1: ShapeId, pick1: Vec2, id2: ShapeId, pick2: Vec2, radius: number, newId: () => ShapeId): EditResult {
  const s1 = doc.shapes.find((s) => s.id === id1);
  const s2 = doc.shapes.find((s) => s.id === id2);
  if (!s1 || !s2) return fail('Object not found');
  if (s1.kind === 'line' && s2.kind === 'line') return filletLines(doc, id1, pick1, id2, pick2, radius, newId);
  if (id1 === id2) return fail('Fillet needs two different objects');
  const ok = (s: Shape): s is Ent => s.kind === 'line' || s.kind === 'circle' || s.kind === 'arc';
  if (!ok(s1) || !ok(s2)) return fail('Fillet works between lines, circles and arcs');
  if (!(radius > 0) || !Number.isFinite(radius)) return fail('A fillet with a circle or arc needs a radius greater than zero');
  if (s1.kind === 'line' && distance(s1.start, s1.end) < EPS) return fail('Cannot fillet a zero-length line');
  if (s2.kind === 'line' && distance(s2.start, s2.end) < EPS) return fail('Cannot fillet a zero-length line');

  let best: { C: Vec2; T1: Vec2; T2: Vec2; score: number } | null = null;
  for (const a of loci(s1, radius))
    for (const b of loci(s2, radius))
      for (const C of meet(a, b)) {
        const T1 = tangentPoint(s1, C, radius);
        const T2 = tangentPoint(s2, C, radius);
        if (distance(T1, T2) < 1e-7) continue; // degenerate (objects touch where the fillet would be)
        const score = distance(T1, pick1) + distance(T2, pick2);
        if (!best || score < best.score) best = { C, T1, T2, score };
      }
  if (!best) return fail(`No R${radius} mm fillet fits between these objects – try a different radius`);

  const e1 = trimTo(s1, best.T1, pick1);
  const e2 = trimTo(s2, best.T2, pick2);
  if (!e1 || !e2) return fail('The fillet would remove a whole object – click each object on the part you want to keep');

  const a1 = angleAt(best.C, best.T1);
  const a2 = angleAt(best.C, best.T2);
  const ccw = normalizeAngle(a2 - a1);
  const [startDeg, sweepDeg] = ccw <= 180 ? [a1, ccw] : [a2, 360 - ccw];
  const arc: ArcShape = { id: newId(), kind: 'arc', style: s1.style, ...(s1.layerId ? { layerId: s1.layerId } : {}), center: best.C, radius, startDeg: normalizeAngle(startDeg), sweepDeg };
  const shapes = doc.shapes.map((s) => (s.id === e1.id ? e1 : s.id === e2.id ? e2 : s));
  return { ok: true, doc: { ...doc, shapes: [...shapes, arc] }, selection: [arc.id], message: `Fillet R${radius} mm added` };
}
