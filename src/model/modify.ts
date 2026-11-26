import { normalizeAngle } from '../geometry/angles';
import { lineLineIntersection, lineParamsWithPrimitive, mirrorPoint } from '../geometry/intersect';
import { add, distance, dot, EPSILON, length, mul, sub, vec, type Vec2 } from '../geometry/vec';
import { shapePrimitives } from './anchors';
import { retargetAnchors } from './dimensions';
import { arcEnd, normalizeArc } from './arcs';
import { trimCurve, trimCurvePreview } from './curves';
import { trimPolyline, trimPolylinePreview } from './polylineTrim';
import { rectCorners } from './shapes';
import type { DrawingDocument, LineShape, PolylineShape, RectShape, Shape, ShapeId } from './types';

/**
 * Geometry-editing operations (trim, extend, offset, mirror).
 * Each returns either a complete new document or a refusal with a reason.
 * They never return a partially edited document and never delete geometry implicitly.
 */
export type EditResult =
  | { readonly ok: true; readonly doc: DrawingDocument; readonly selection: readonly ShapeId[]; readonly message: string }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): EditResult => ({ ok: false, message });
const MIN_LEN = 1e-9;
const pointAt = (l: LineShape, t: number): Vec2 => add(l.start, mul(sub(l.end, l.start), t));
const replace = (doc: DrawingDocument, s: Shape): DrawingDocument => ({ ...doc, shapes: doc.shapes.map((x) => (x.id === s.id ? s : x)) });

/** Interior parameters (0 < t < 1) where the line is cut by any OTHER shape. */
function cuttingParams(doc: DrawingDocument, l: LineShape): number[] {
  const ts: number[] = [];
  for (const s of doc.shapes) {
    if (s.id === l.id) continue;
    for (const prim of shapePrimitives(s)) {
      for (const t of lineParamsWithPrimitive(l.start, l.end, prim)) if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-12);
}

function asLine(doc: DrawingDocument, id: ShapeId, op: string): LineShape | string {
  const s = doc.shapes.find((x) => x.id === id);
  if (!s) return 'Object not found';
  if (s.kind !== 'line') {
    return op === 'Trim'
      ? 'Trim works on lines, circles, arcs and polylines. Rectangles act as cutting edges but cannot be trimmed.'
      : 'Extend works on lines. Other objects act as boundaries but cannot be extended.';
  }
  if (distance(s.start, s.end) < MIN_LEN) return `Cannot ${op.toLowerCase()} a zero-length line`;
  return s;
}

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

/** Parameter interval [t0, t1] of the line that a trim at `pick` would remove, or null if nothing cuts it. */
function trimInterval(doc: DrawingDocument, l: LineShape, pick: Vec2): [number, number] | null {
  const cuts = cuttingParams(doc, l);
  if (cuts.length === 0) return null;
  const d = sub(l.end, l.start);
  const tp = Math.max(0, Math.min(1, dot(sub(pick, l.start), d) / dot(d, d)));
  const bounds = [0, ...cuts, 1];
  let i = 0;
  while (i < bounds.length - 2 && tp > bounds[i + 1]) i++;
  return [bounds[i], bounds[i + 1]];
}

/** The segment a trim at `pick` would remove (for previews), or null if the trim would be refused. */
export function trimPreview(doc: DrawingDocument, lineId: ShapeId, pick: Vec2): [Vec2, Vec2] | null {
  const l = asLine(doc, lineId, 'Trim');
  if (typeof l === 'string') return null;
  const span = trimInterval(doc, l, pick);
  return span ? [pointAt(l, span[0]), pointAt(l, span[1])] : null;
}

/**
 * Remove the part of a line between the two cutting edges nearest the pick point
 * (or between a cutting edge and the line's end). If the picked part lies between
 * two cuts, the line is split in two (the far piece gets `newId`).
 * A line that no other object crosses is NOT deleted – the operation is refused.
 */
export function trimLine(doc: DrawingDocument, lineId: ShapeId, pick: Vec2, newId: () => ShapeId): EditResult {
  const l = asLine(doc, lineId, 'Trim');
  if (typeof l === 'string') return fail(l);
  const span = trimInterval(doc, l, pick);
  if (!span) return fail('Nothing crosses this line – there is no cutting edge to trim to');
  const [t0, t1] = span;

  if (t0 === 0) {
    const trimmed = { ...l, start: pointAt(l, t1) };
    return { ok: true, doc: replace(doc, trimmed), selection: [l.id], message: 'Trimmed line start' };
  }
  if (t1 === 1) {
    const trimmed = { ...l, end: pointAt(l, t0) };
    return { ok: true, doc: replace(doc, trimmed), selection: [l.id], message: 'Trimmed line end' };
  }
  // Middle portion: split. The original keeps its start; a new line keeps the original end.
  const first: LineShape = { ...l, end: pointAt(l, t0) };
  const second: LineShape = { ...l, id: newId(), start: pointAt(l, t1) };
  const shapes = doc.shapes.flatMap((s) => (s.id === l.id ? [first, second] : [s]));
  // Dimensions linked to the original END follow it onto the new piece.
  const dimensions = retargetAnchors(doc.dimensions, { shapeId: l.id, key: 'end' }, { shapeId: second.id, key: 'end' });
  return { ok: true, doc: { ...doc, shapes, dimensions }, selection: [first.id, second.id], message: 'Trimmed middle of line (split into two lines)' };
}

/** Trim any trimmable object (line, circle → arc, arc) at the cutting edges around `pick`. */
export function trimShape(doc: DrawingDocument, id: ShapeId, pick: Vec2, newId: () => ShapeId): EditResult {
  const s = doc.shapes.find((x) => x.id === id);
  if (s && (s.kind === 'circle' || s.kind === 'arc')) return trimCurve(doc, id, pick, newId);
  if (s && s.kind === 'polyline') {
    const r = trimPolyline(doc, id, pick, newId);
    return r.ok ? { ok: true, doc: r.doc, selection: r.selection, message: r.message } : fail(r.message);
  }
  return trimLine(doc, id, pick, newId);
}

/** The piece a trim at `pick` would remove, as a shape (line segment or arc), or null if refused. */
export function trimPreviewShape(doc: DrawingDocument, id: ShapeId, pick: Vec2): Shape | null {
  const s = doc.shapes.find((x) => x.id === id);
  if (!s) return null;
  if (s.kind === 'circle' || s.kind === 'arc') return trimCurvePreview(doc, id, pick);
  if (s.kind === 'polyline') return trimPolylinePreview(doc, id, pick);
  const seg = trimPreview(doc, id, pick);
  return seg ? { ...s, id: '__trim__', kind: 'line', start: seg[0], end: seg[1] } as Shape : null;
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

/** Extend the end of a line nearest `pick` to the first boundary (any other object) in that direction. */
export function extendLine(doc: DrawingDocument, lineId: ShapeId, pick: Vec2): EditResult {
  const l = asLine(doc, lineId, 'Extend');
  if (typeof l === 'string') return fail(l);
  const atEnd = distance(pick, l.end) <= distance(pick, l.start);
  let best: number | null = null;
  for (const s of doc.shapes) {
    if (s.id === l.id) continue;
    for (const prim of shapePrimitives(s)) {
      for (const t of lineParamsWithPrimitive(l.start, l.end, prim)) {
        if (atEnd && t > 1 + 1e-9 && (best === null || t < best)) best = t;
        if (!atEnd && t < -1e-9 && (best === null || t > best)) best = t;
      }
    }
  }
  if (best === null) return fail('No boundary found in that direction – the line was not changed');
  const p = pointAt(l, best);
  const updated = atEnd ? { ...l, end: p } : { ...l, start: p };
  return { ok: true, doc: replace(doc, updated), selection: [l.id], message: `Extended line ${atEnd ? 'end' : 'start'} by ${(distance(l.start, l.end) * Math.abs(best - (atEnd ? 1 : 0))).toFixed(3)} mm` };
}

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

const leftNormal = (a: Vec2, b: Vec2): Vec2 => {
  const d = sub(b, a);
  const l = length(d);
  return vec(-d.y / l, d.x / l);
};

function offsetPolyline(p: PolylineShape, dist: number, side: Vec2, id: ShapeId): PolylineShape | string {
  let pts = p.points.filter((q, i) => i === 0 || distance(q, p.points[i - 1]) > MIN_LEN);
  const closed = !!p.closed && pts.length > 2;
  if (closed) {
    if (distance(pts[0], pts[pts.length - 1]) <= MIN_LEN) pts = pts.slice(0, -1);
    pts = [...pts, pts[0]]; // treat as open with the closing segment, then re-join the ends
  }
  if (pts.length < 2) return 'Cannot offset a polyline with zero length';
  // Side: sign of the side point relative to the nearest segment.
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const ab = sub(pts[i + 1], a);
    const t = Math.max(0, Math.min(1, dot(sub(side, a), ab) / dot(ab, ab)));
    const dd = distance(side, add(a, mul(ab, t)));
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  const sgn = Math.sign(dot(sub(side, pts[best]), leftNormal(pts[best], pts[best + 1])));
  if (sgn === 0) return 'Pick a point to one side of the polyline';
  const k = dist * sgn;
  const segs = pts.slice(0, -1).map((a, i) => {
    const n = mul(leftNormal(a, pts[i + 1]), k);
    return [add(a, n), add(pts[i + 1], n)] as const;
  });
  const out: Vec2[] = [segs[0][0]];
  for (let i = 1; i < segs.length; i++) {
    const hit = lineLineIntersection(segs[i - 1][0], segs[i - 1][1], segs[i][0], segs[i][1]);
    // Parallel neighbours, or very sharp corners (long mitre): bevel instead of a spike.
    if (!hit || distance(hit.point, pts[i]) > 4 * dist) out.push(segs[i - 1][1], segs[i][0]);
    else out.push(hit.point);
  }
  out.push(segs[segs.length - 1][1]);
  if (closed) {
    // Mitre the corner at the first vertex (between the closing segment and the first one).
    const last = segs[segs.length - 1];
    const hit = lineLineIntersection(last[0], last[1], segs[0][0], segs[0][1]);
    const corner = hit && distance(hit.point, pts[0]) <= 4 * dist ? [hit.point] : [last[1], segs[0][0]];
    return { ...p, id, points: [...corner, ...out.slice(1, -1)], closed: true };
  }
  return { ...p, id, points: out };
}

/**
 * Offset a shape by `dist` (drawing mm) towards `side`. Creates a NEW shape.
 * Line → parallel line; circle → concentric circle; rectangle → inset/outset rectangle;
 * polyline → parallel polyline with mitred (or bevelled) corners.
 */
export function offsetShape(doc: DrawingDocument, shapeId: ShapeId, dist: number, side: Vec2, newId: () => ShapeId): EditResult {
  if (!(dist > 0) || !Number.isFinite(dist)) return fail('Offset distance must be greater than zero');
  const s = doc.shapes.find((x) => x.id === shapeId);
  if (!s) return fail('Object not found');
  let created: Shape;
  switch (s.kind) {
    case 'line': {
      if (distance(s.start, s.end) < MIN_LEN) return fail('Cannot offset a zero-length line');
      const n = leftNormal(s.start, s.end);
      const sgn = Math.sign(dot(sub(side, s.start), n));
      if (sgn === 0) return fail('Pick a point to one side of the line, not on it');
      const v = mul(n, dist * sgn);
      created = { ...s, id: newId(), start: add(s.start, v), end: add(s.end, v) };
      break;
    }
    case 'arc': {
      const outside = distance(side, s.center) > s.radius;
      const r = outside ? s.radius + dist : s.radius - dist;
      if (r <= MIN_LEN) return fail(`Offset of ${dist} mm inside an arc of radius ${s.radius} mm is not possible`);
      created = { ...s, id: newId(), radius: r };
      break;
    }
    case 'circle': {
      const outside = distance(side, s.center) > s.radius;
      const r = outside ? s.radius + dist : s.radius - dist;
      if (r <= MIN_LEN) return fail(`Offset of ${dist} mm inside a circle of radius ${s.radius} mm is not possible`);
      created = { ...s, id: newId(), radius: r };
      break;
    }
    case 'rect': {
      const r = s as RectShape;
      const local = (() => {
        const d = sub(side, r.origin);
        const a = (-r.rotationDeg * Math.PI) / 180;
        return vec(d.x * Math.cos(a) - d.y * Math.sin(a), d.x * Math.sin(a) + d.y * Math.cos(a));
      })();
      const inside = local.x > 0 && local.x < r.width && local.y > 0 && local.y < r.height;
      const k = inside ? -dist : dist;
      const w = r.width + 2 * k;
      const h = r.height + 2 * k;
      if (w <= MIN_LEN || h <= MIN_LEN) return fail(`Offset of ${dist} mm inside this rectangle would make it vanish`);
      const a = (r.rotationDeg * Math.PI) / 180;
      const shift = vec(-k * Math.cos(a) + k * Math.sin(a), -k * Math.sin(a) - k * Math.cos(a));
      created = { ...r, id: newId(), origin: add(r.origin, shift), width: w, height: h };
      break;
    }
    case 'polyline': {
      const res = offsetPolyline(s, dist, side, newId());
      if (typeof res === 'string') return fail(res);
      created = res;
      break;
    }
  }
  return { ok: true, doc: { ...doc, shapes: [...doc.shapes, created] }, selection: [created.id], message: `Offset by ${dist} mm` };
}

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------

/** Mirror image of a shape about the line a–b (exact; rectangles remain rectangles). */
export function mirrorShape<S extends Shape>(s: S, a: Vec2, b: Vec2): S {
  const m = (p: Vec2) => mirrorPoint(p, a, b);
  switch (s.kind) {
    case 'line':
      return { ...s, start: m(s.start), end: m(s.end) };
    case 'circle':
      return { ...s, center: m(s.center) };
    case 'arc': {
      // Reflection reverses orientation: the image of the END becomes the new start.
      const c = m(s.center);
      const e = m(arcEnd(s));
      return normalizeArc({ ...s, center: c, startDeg: (Math.atan2(e.y - c.y, e.x - c.x) * 180) / Math.PI }) as S;
    }
    case 'polyline':
      return { ...s, points: s.points.map(m) };
    case 'rect': {
      // A reflection reverses orientation: the mirrored local +Y axis points "down",
      // so the new base corner is the image of the old top-left corner (c3).
      const axisDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      let rot = normalizeAngle(2 * axisDeg - s.rotationDeg);
      if (rot > 180) rot -= 360;
      return { ...s, origin: m(rectCorners(s)[3]), rotationDeg: Math.abs(rot) < 1e-12 ? 0 : rot };
    }
  }
}

/** Mirror shapes about the line a–b. keepSource: add mirrored copies; otherwise replace in place. */
export function mirrorShapes(
  doc: DrawingDocument,
  ids: readonly ShapeId[],
  a: Vec2,
  b: Vec2,
  keepSource: boolean,
  newId: () => ShapeId,
): EditResult {
  if (distance(a, b) < EPSILON) return fail('Mirror line has zero length – pick two different points');
  const set = new Set(ids);
  const targets = doc.shapes.filter((s) => set.has(s.id));
  if (targets.length === 0) return fail('Select the objects to mirror first');
  if (keepSource) {
    const copies = targets.map((s) => ({ ...mirrorShape(s, a, b), id: newId() }));
    return { ok: true, doc: { ...doc, shapes: [...doc.shapes, ...copies] }, selection: copies.map((c) => c.id), message: `Mirrored ${copies.length} object${copies.length === 1 ? '' : 's'} (copy)` };
  }
  const shapes = doc.shapes.map((s) => (set.has(s.id) ? mirrorShape(s, a, b) : s));
  return { ok: true, doc: { ...doc, shapes }, selection: targets.map((s) => s.id), message: `Mirrored ${targets.length} object${targets.length === 1 ? '' : 's'}` };
}
