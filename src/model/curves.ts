import { normalizeAngle } from '../geometry/angles';
import { angleAt } from '../geometry/arc';
import { intersectPrimitives, lineLineIntersection, type Primitive } from '../geometry/intersect';
import { add, distance, dot, length, mul, sub, type Vec2 } from '../geometry/vec';
import { shapePrimitives } from './anchors';
import { retargetAnchors } from './dimensions';
import type { EditResult } from './modify';
import { createLine } from './shapes';
import type { ArcShape, CircleShape, DrawingDocument, LineShape, Shape, ShapeId } from './types';

/**
 * Curve editing (Milestone 5): trimming circles and arcs, fillet and chamfer between lines.
 * Like the other modify operations, every function returns a complete new document or a
 * refusal with a reason; geometry is never partially edited or silently deleted.
 */
const fail = (message: string): EditResult => ({ ok: false, message });
const ANG_TOL = 1e-7;

/** Arc shape from a circle (same id, style and layer) covering [startDeg, startDeg + sweepDeg]. */
function toArc(s: CircleShape | ArcShape, startDeg: number, sweepDeg: number): ArcShape {
  return { id: s.id, kind: 'arc', style: s.style, ...(s.layerId ? { layerId: s.layerId } : {}), center: s.center, radius: s.radius, startDeg: normalizeAngle(startDeg), sweepDeg };
}

/** Angles (deg) where OTHER shapes cross the curve; for an arc, only those strictly inside it. */
function cutAngles(doc: DrawingDocument, s: CircleShape | ArcShape): number[] {
  const circle: Primitive = { type: 'circle', c: s.center, r: s.radius };
  const out: number[] = [];
  for (const o of doc.shapes) {
    if (o.id === s.id) continue;
    for (const prim of shapePrimitives(o)) {
      for (const p of intersectPrimitives(circle, prim)) {
        const a = angleAt(s.center, p);
        if (s.kind === 'arc') {
          const rel = normalizeAngle(a - s.startDeg);
          if (rel <= ANG_TOL || rel >= s.sweepDeg - ANG_TOL) continue;
        }
        out.push(a);
      }
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((a, i) => i === 0 || a - out[i - 1] > ANG_TOL);
}

interface CurveTrimPlan {
  /** The piece that would be removed (for previews). */
  readonly removed: ArcShape;
  readonly apply: (newId: () => ShapeId) => EditResult;
}

function planCurveTrim(doc: DrawingDocument, s: CircleShape | ArcShape, pick: Vec2): CurveTrimPlan | string {
  const cuts = cutAngles(doc, s);
  const pickDeg = angleAt(s.center, pick);

  if (s.kind === 'circle') {
    if (cuts.length < 2) return 'A circle needs at least two crossing objects to trim between – nothing was changed';
    for (let i = 0; i < cuts.length; i++) {
      const a = cuts[i];
      const b = cuts[(i + 1) % cuts.length];
      const span = normalizeAngle(b - a) || 360;
      if (normalizeAngle(pickDeg - a) < span) {
        return {
          removed: toArc(s, a, span),
          apply: () => ({ ok: true, doc: replace(doc, toArc(s, b, 360 - span)), selection: [s.id], message: 'Trimmed circle (now an arc)' }),
        };
      }
    }
    return 'Could not locate the picked part of the circle';
  }

  if (cuts.length === 0) return 'Nothing crosses this arc – there is no cutting edge to trim to';
  let rel = normalizeAngle(pickDeg - s.startDeg);
  if (rel > s.sweepDeg) rel = rel > s.sweepDeg + (360 - s.sweepDeg) / 2 ? 0 : s.sweepDeg; // picked beyond an end
  const bounds = [0, ...cuts.map((a) => normalizeAngle(a - s.startDeg)).sort((x, y) => x - y), s.sweepDeg];
  let i = 0;
  while (i < bounds.length - 2 && rel > bounds[i + 1]) i++;
  const [t0, t1] = [bounds[i], bounds[i + 1]];
  const removed = toArc(s, s.startDeg + t0, t1 - t0);
  if (t0 === 0) {
    return { removed, apply: () => ({ ok: true, doc: replace(doc, toArc(s, s.startDeg + t1, s.sweepDeg - t1)), selection: [s.id], message: 'Trimmed arc start' }) };
  }
  if (t1 === s.sweepDeg) {
    return { removed, apply: () => ({ ok: true, doc: replace(doc, toArc(s, s.startDeg, t0)), selection: [s.id], message: 'Trimmed arc end' }) };
  }
  return {
    removed,
    apply: (newId) => {
      const first = toArc(s, s.startDeg, t0);
      const second: ArcShape = { ...toArc(s, s.startDeg + t1, s.sweepDeg - t1), id: newId() };
      const shapes = doc.shapes.flatMap((x) => (x.id === s.id ? [first, second] : [x]));
      const dimensions = retargetAnchors(doc.dimensions, { shapeId: s.id, key: 'end' }, { shapeId: second.id, key: 'end' });
      return { ok: true, doc: { ...doc, shapes, dimensions }, selection: [first.id, second.id], message: 'Trimmed middle of arc (split into two arcs)' };
    },
  };
}

const replace = (doc: DrawingDocument, s: Shape): DrawingDocument => ({ ...doc, shapes: doc.shapes.map((x) => (x.id === s.id ? s : x)) });

/** Trim a circle (→ arc) or an arc at the cutting edges around the pick point. */
export function trimCurve(doc: DrawingDocument, id: ShapeId, pick: Vec2, newId: () => ShapeId): EditResult {
  const s = doc.shapes.find((x) => x.id === id);
  if (!s || (s.kind !== 'circle' && s.kind !== 'arc')) return fail('Object not found');
  if (s.radius < 1e-9) return fail('Cannot trim a zero-radius circle');
  const plan = planCurveTrim(doc, s, pick);
  return typeof plan === 'string' ? fail(plan) : plan.apply(newId);
}

/** The arc a trim at `pick` would remove (preview), or null if the trim would be refused. */
export function trimCurvePreview(doc: DrawingDocument, id: ShapeId, pick: Vec2): ArcShape | null {
  const s = doc.shapes.find((x) => x.id === id);
  if (!s || (s.kind !== 'circle' && s.kind !== 'arc')) return null;
  const plan = planCurveTrim(doc, s, pick);
  return typeof plan === 'string' ? null : plan.removed;
}

// ---------------------------------------------------------------------------
// Fillet and chamfer between two lines
// ---------------------------------------------------------------------------

interface Corner {
  readonly l1: LineShape;
  readonly l2: LineShape;
  readonly x: Vec2;
  /** Unit directions from the corner towards the kept part of each line. */
  readonly u1: Vec2;
  readonly u2: Vec2;
  /** Distance from the corner to the far (kept) end of each line. */
  readonly reach1: number;
  readonly reach2: number;
  /** Angle between the kept directions (degrees, 0–180). */
  readonly angleDeg: number;
}

function corner(doc: DrawingDocument, id1: ShapeId, pick1: Vec2, id2: ShapeId, pick2: Vec2, op: string): Corner | string {
  if (id1 === id2) return `${op} needs two different lines`;
  const l1 = doc.shapes.find((s) => s.id === id1);
  const l2 = doc.shapes.find((s) => s.id === id2);
  if (!l1 || !l2 || l1.kind !== 'line' || l2.kind !== 'line') return `${op} works between two lines`;
  if (distance(l1.start, l1.end) < 1e-9 || distance(l2.start, l2.end) < 1e-9) return `Cannot ${op.toLowerCase()} a zero-length line`;
  const hit = lineLineIntersection(l1.start, l1.end, l2.start, l2.end);
  if (!hit) return `The lines are parallel – they have no corner to ${op.toLowerCase()}`;
  const x = hit.point;
  const side = (l: LineShape, pick: Vec2) => {
    const d = sub(l.end, l.start);
    const u = mul(d, 1 / length(d));
    const s = Math.sign(dot(sub(pick, x), u)) || Math.sign(dot(sub(l.start, x), u)) || 1;
    const dir = mul(u, s);
    const reach = Math.max(dot(sub(l.start, x), dir), dot(sub(l.end, x), dir));
    return { dir, reach };
  };
  const a = side(l1, pick1);
  const b = side(l2, pick2);
  if (a.reach <= 1e-9 || b.reach <= 1e-9) return 'Click each line on the side you want to keep';
  const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot(a.dir, b.dir)))) * 180) / Math.PI;
  return { l1, l2, x, u1: a.dir, u2: b.dir, reach1: a.reach, reach2: b.reach, angleDeg };
}

/**
 * Move the end of `l` that is NOT on the kept side to `p`. The kept end is the one furthest
 * along `u` (the direction from the corner towards the picked part) – this is right both for
 * lines that stop short of the corner and for lines that cross it.
 */
function endAt(l: LineShape, x: Vec2, u: Vec2, p: Vec2): LineShape {
  return dot(sub(l.start, x), u) <= dot(sub(l.end, x), u) ? { ...l, start: p } : { ...l, end: p };
}

/**
 * Fillet: round the corner between two lines with an arc of `radius`, trimming or extending
 * both lines to the tangent points. Radius 0 makes a sharp corner (lines meet exactly).
 * The parts of the lines on the picked sides are kept.
 */
export function filletLines(doc: DrawingDocument, id1: ShapeId, pick1: Vec2, id2: ShapeId, pick2: Vec2, radius: number, newId: () => ShapeId): EditResult {
  if (!(radius >= 0) || !Number.isFinite(radius)) return fail('Fillet radius must be zero or greater');
  const c = corner(doc, id1, pick1, id2, pick2, 'Fillet');
  if (typeof c === 'string') return fail(c);
  if (c.angleDeg < 1e-6 || c.angleDeg > 180 - 1e-6) return fail('The lines are collinear – there is no corner to round');
  if (radius === 0) {
    const d = replace(replace(doc, endAt(c.l1, c.x, c.u1, c.x)), endAt(c.l2, c.x, c.u2, c.x));
    return { ok: true, doc: d, selection: [c.l1.id, c.l2.id], message: 'Corner made sharp (fillet radius 0)' };
  }
  const half = ((c.angleDeg / 2) * Math.PI) / 180;
  const t = radius / Math.tan(half);
  if (t > c.reach1 + 1e-9 || t > c.reach2 + 1e-9) {
    return fail(`A ${radius} mm fillet needs ${t.toFixed(3)} mm of each line from the corner – the lines are too short`);
  }
  const t1 = add(c.x, mul(c.u1, t));
  const t2 = add(c.x, mul(c.u2, t));
  const bis = add(c.u1, c.u2);
  const centre = add(c.x, mul(bis, radius / Math.sin(half) / length(bis)));
  const a1 = angleAt(centre, t1);
  const a2 = angleAt(centre, t2);
  const ccw = normalizeAngle(a2 - a1);
  const [startDeg, sweepDeg] = ccw <= 180 ? [a1, ccw] : [a2, 360 - ccw];
  const arc: ArcShape = { id: newId(), kind: 'arc', style: c.l1.style, ...(c.l1.layerId ? { layerId: c.l1.layerId } : {}), center: centre, radius, startDeg, sweepDeg };
  const d = replace(replace(doc, endAt(c.l1, c.x, c.u1, t1)), endAt(c.l2, c.x, c.u2, t2));
  return { ok: true, doc: { ...d, shapes: [...d.shapes, arc] }, selection: [arc.id], message: `Fillet R${radius} mm added` };
}

/**
 * Chamfer: cut the corner between two lines with a straight line at distances d1 and d2
 * from the corner along each line. Distances of 0 make a sharp corner.
 */
export function chamferLines(doc: DrawingDocument, id1: ShapeId, pick1: Vec2, id2: ShapeId, pick2: Vec2, d1: number, d2: number, newId: () => ShapeId): EditResult {
  if (!(d1 >= 0) || !(d2 >= 0) || !Number.isFinite(d1) || !Number.isFinite(d2)) return fail('Chamfer distances must be zero or greater');
  const c = corner(doc, id1, pick1, id2, pick2, 'Chamfer');
  if (typeof c === 'string') return fail(c);
  if (c.angleDeg < 1e-6 || c.angleDeg > 180 - 1e-6) return fail('The lines are collinear – there is no corner to chamfer');
  if (d1 > c.reach1 + 1e-9 || d2 > c.reach2 + 1e-9) return fail('The chamfer distance is longer than a line');
  const p1 = add(c.x, mul(c.u1, d1));
  const p2 = add(c.x, mul(c.u2, d2));
  const d = replace(replace(doc, endAt(c.l1, c.x, c.u1, p1)), endAt(c.l2, c.x, c.u2, p2));
  if (d1 === 0 && d2 === 0) return { ok: true, doc: d, selection: [c.l1.id, c.l2.id], message: 'Corner made sharp (chamfer 0)' };
  const cut = { ...createLine(newId(), p1, p2, c.l1.style), ...(c.l1.layerId ? { layerId: c.l1.layerId } : {}) };
  return { ok: true, doc: { ...d, shapes: [...d.shapes, cut] }, selection: [cut.id], message: `Chamfer ${d1} × ${d2} mm added` };
}
