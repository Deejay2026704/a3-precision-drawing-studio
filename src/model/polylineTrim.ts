import { lineParamsWithPrimitive } from '../geometry/intersect';
import { add, distance, dot, mul, sub, type Vec2 } from '../geometry/vec';
import { resolveShapeKey, shapePrimitives } from './anchors';
import { polylineSegments } from './shapes';
import type { DimAnchor, Dimension, DrawingDocument, PolylineShape, Shape, ShapeId } from './types';

/**
 * Trimming polylines. Positions along a polyline are measured by a parameter u:
 * segment i covers u ∈ [i, i+1] (for a closed polyline the last segment is the closing one).
 * Cuts are where OTHER objects cross it.
 */
export type PolyTrimResult =
  | { ok: true; doc: DrawingDocument; selection: ShapeId[]; message: string; removed: PolylineShape }
  | { ok: false; message: string };

const EPS = 1e-9;

function cuts(doc: DrawingDocument, p: PolylineShape): number[] {
  const segs = polylineSegments(p);
  const us: number[] = [];
  segs.forEach(([a, b], i) => {
    if (distance(a, b) < EPS) return;
    for (const s of doc.shapes) {
      if (s.id === p.id) continue;
      for (const prim of shapePrimitives(s)) for (const t of lineParamsWithPrimitive(a, b, prim)) if (t > -1e-12 && t < 1 + 1e-12) us.push(i + Math.min(1, Math.max(0, t)));
    }
  });
  const n = segs.length;
  us.sort((x, y) => x - y);
  // Drop duplicates (a crossing exactly at a vertex is found on both segments) and,
  // for open polylines, cuts at the very ends (nothing to remove there).
  return us.filter((u, i) => (i === 0 || u - us[i - 1] > 1e-9) && (p.closed || (u > EPS && u < n - EPS)));
}

/** Parameter of the point on the polyline nearest `pick`. */
function paramAt(p: PolylineShape, pick: Vec2): number {
  let best = { u: 0, d: Infinity };
  polylineSegments(p).forEach(([a, b], i) => {
    const ab = sub(b, a);
    const L2 = dot(ab, ab);
    const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(pick, a), ab) / L2));
    const d = distance(pick, add(a, mul(ab, t)));
    if (d < best.d) best = { u: i + t, d };
  });
  return best.u;
}

function pointAtParam(p: PolylineShape, u: number): Vec2 {
  const segs = polylineSegments(p);
  const n = segs.length;
  const w = p.closed ? ((u % n) + n) % n : Math.max(0, Math.min(n, u));
  const i = Math.min(n - 1, Math.floor(w + 1e-12));
  const [a, b] = segs[i];
  return add(a, mul(sub(b, a), Math.max(0, Math.min(1, w - i))));
}

/** Vertices of the piece from u0 to u1 (u1 > u0; may exceed n on closed polylines = wrap round). */
function piece(p: PolylineShape, u0: number, u1: number): Vec2[] {
  const out: Vec2[] = [pointAtParam(p, u0)];
  for (let k = Math.floor(u0 + 1e-12) + 1; k < u1 - 1e-12; k++) out.push(p.points[k % p.points.length]);
  if (u1 - u0 > EPS) out.push(pointAtParam(p, u1));
  return out.filter((q, i) => i === 0 || distance(q, out[i - 1]) > EPS);
}

/** Interval [lo, hi] that a trim at `pick` removes, or a refusal. */
function interval(doc: DrawingDocument, p: PolylineShape, pick: Vec2): [number, number] | string {
  const n = polylineSegments(p).length;
  if (n === 0) return 'Cannot trim a single point';
  const cs = cuts(doc, p);
  const up = paramAt(p, pick);
  if (p.closed) {
    if (cs.length < 2) return 'A closed polyline must be crossed in at least two places to trim it';
    const lo = [...cs].reverse().find((c) => c <= up) ?? cs[cs.length - 1] - n;
    const hi = cs.find((c) => c > up) ?? cs[0] + n;
    return [lo, hi];
  }
  if (cs.length === 0) return 'Nothing crosses this polyline – there is no cutting edge to trim to';
  const lo = [...cs].reverse().find((c) => c <= up) ?? 0;
  const hi = cs.find((c) => c > up) ?? n;
  return [lo, hi];
}

/** Dimension anchors on the trimmed polyline are fixed where they are (vertex numbering changes). */
function freezeAnchors(dims: readonly Dimension[], p: PolylineShape): Dimension[] {
  const fix = (a: DimAnchor): DimAnchor => {
    if (a.kind !== 'shape' || a.shapeId !== p.id) return a;
    const at = resolveShapeKey(p, a.key);
    return at ? { kind: 'point', point: at } : a;
  };
  return dims.map((d) => (d.kind === 'aligned' || d.kind === 'horizontal' || d.kind === 'vertical' ? { ...d, p1: fix(d.p1), p2: fix(d.p2) } : d));
}

export function trimPolyline(doc: DrawingDocument, id: ShapeId, pick: Vec2, newId: () => ShapeId): PolyTrimResult {
  const p = doc.shapes.find((s): s is PolylineShape => s.id === id && s.kind === 'polyline');
  if (!p) return { ok: false, message: 'Object not found' };
  const iv = interval(doc, p, pick);
  if (typeof iv === 'string') return { ok: false, message: iv };
  const [lo, hi] = iv;
  const n = polylineSegments(p).length;

  let keep: Vec2[][];
  if (p.closed) {
    keep = [piece(p, hi, lo + n)]; // the rest, going on round from the far cut
  } else {
    keep = [lo > EPS ? piece(p, 0, lo) : [], hi < n - EPS ? piece(p, hi, n) : []].filter((k) => k.length > 0);
  }
  keep = keep.filter((k) => k.length >= 2);
  if (keep.length === 0) return { ok: false, message: 'Trimming here would remove the whole polyline' };
  const open = (pts: Vec2[], newid: ShapeId): PolylineShape => {
    const { closed: _c, ...rest } = p;
    void _c;
    return { ...rest, id: newid, points: pts };
  };
  const pieces = keep.map((k, i) => open(k, i === 0 ? p.id : newId()));
  const removed = open(piece(p, lo, hi), '__trim__');
  const shapes: Shape[] = doc.shapes.flatMap((s) => (s.id === p.id ? pieces : [s]));
  const what = p.closed ? 'closed polyline opened' : pieces.length === 2 ? 'polyline split in two' : 'polyline end trimmed';
  return { ok: true, doc: { ...doc, shapes, dimensions: freezeAnchors(doc.dimensions, p) }, selection: pieces.map((x) => x.id), message: `Trimmed – ${what}`, removed };
}

export function trimPolylinePreview(doc: DrawingDocument, id: ShapeId, pick: Vec2): PolylineShape | null {
  const r = trimPolyline(doc, id, pick, () => '__preview2__');
  return r.ok ? r.removed : null;
}
