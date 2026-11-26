import { angleBetweenPoints, normalizeAngle, rotateVec } from '../geometry/angles';
import { cross, lineLineIntersection } from '../geometry/intersect';
import { pageLengthToWorld, type DrawingScale } from '../geometry/scale';
import { add, distance, distanceToSegment, dot, EPSILON, length, midpoint, mul, sub, vec, type Vec2 } from '../geometry/vec';
import { resolveAnchor } from './anchors';
import type {
  AngularDimension,
  DimAnchor,
  Dimension,
  DimensionStyle,
  DrawingDocument,
  LineShape,
  LinearDimension,
  RadialDimension,
  ShapeId,
} from './types';

/**
 * Associative, DRIVEN dimensions. Nothing measured is ever stored: every value and
 * every definition point is recomputed from the linked geometry on demand, so a
 * dimension stays correct when its geometry is moved, resized, trimmed or edited.
 */
type DocLike = Pick<DrawingDocument, 'shapes'>;

const unit = (v: Vec2): Vec2 => {
  const l = length(v);
  return l < EPSILON ? vec(1, 0) : mul(v, 1 / l);
};
const dirVec = (deg: number): Vec2 => vec(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));
const findLine = (doc: DocLike, id: ShapeId): LineShape | null => {
  const s = doc.shapes.find((x) => x.id === id);
  return s && s.kind === 'line' ? s : null;
};

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface LinearFrame {
  p1: Vec2;
  p2: Vec2;
  /** Measuring direction (unit). */
  d: Vec2;
  /** Normal (unit), d rotated +90°. */
  n: Vec2;
  /** Feet of the extension lines on the dimension line. */
  f1: Vec2;
  f2: Vec2;
  value: number;
}

function linearFrame(doc: DocLike, dim: LinearDimension): LinearFrame | null {
  const p1 = resolveAnchor(doc, dim.p1);
  const p2 = resolveAnchor(doc, dim.p2);
  if (!p1 || !p2) return null;
  const v = sub(p2, p1);
  const d = dim.kind === 'horizontal' ? vec(1, 0) : dim.kind === 'vertical' ? vec(0, 1) : unit(v);
  const n = vec(-d.y, d.x);
  const value = Math.abs(dot(v, d));
  const f1 = add(p1, mul(n, dim.offset));
  const f2 = add(p2, mul(n, dim.offset - dot(v, n)));
  return { p1, p2, d, n, f1, f2, value };
}

interface AngularFrame {
  vertex: Vec2;
  a1: Vec2;
  a2: Vec2;
  value: number;
  startDeg: number;
  sweepDeg: number;
  l1: LineShape;
  l2: LineShape;
}

function angularFrame(doc: DocLike, dim: AngularDimension): AngularFrame | null {
  const l1 = findLine(doc, dim.line1Id);
  const l2 = findLine(doc, dim.line2Id);
  if (!l1 || !l2) return null;
  const hit = lineLineIntersection(l1.start, l1.end, l2.start, l2.end);
  if (!hit) return null; // parallel or zero-length: no angle
  const a1 = mul(unit(sub(l1.end, l1.start)), dim.sign1);
  const a2 = mul(unit(sub(l2.end, l2.start)), dim.sign2);
  const value = (Math.acos(Math.max(-1, Math.min(1, dot(a1, a2)))) * 180) / Math.PI;
  const t1 = (Math.atan2(a1.y, a1.x) * 180) / Math.PI;
  const t2 = (Math.atan2(a2.y, a2.x) * 180) / Math.PI;
  const ccw = normalizeAngle(t2 - t1);
  const [startDeg, sweepDeg] = ccw <= 180 ? [t1, ccw] : [t2, 360 - ccw];
  return { vertex: hit.point, a1, a2, value, startDeg, sweepDeg, l1, l2 };
}

/** The measured value in drawing mm (or degrees for angular). null = linked geometry missing / undefined. */
export function measureDimension(doc: DocLike, dim: Dimension): number | null {
  switch (dim.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical':
      return linearFrame(doc, dim)?.value ?? null;
    case 'radius':
    case 'diameter': {
      const c = doc.shapes.find((s) => s.id === dim.circleId);
      if (!c || c.kind !== 'circle') return null;
      return dim.kind === 'radius' ? c.radius : 2 * c.radius;
    }
    case 'angular':
      return angularFrame(doc, dim)?.value ?? null;
  }
}

/** Display text, e.g. "100.00", "R25.0", "⌀50", "45.00°". */
export function formatDimensionValue(dim: Pick<Dimension, 'kind'>, value: number, decimals: number): string {
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  let t = value.toFixed(d);
  if (/^-0(\.0*)?$/.test(t)) t = t.slice(1);
  if (dim.kind === 'radius') return `R${t}`;
  if (dim.kind === 'diameter') return `⌀${t}`;
  if (dim.kind === 'angular') return `${t}°`;
  return t;
}

// ---------------------------------------------------------------------------
// Layout (world coordinates) – consumed by the SVG renderer and hit testing
// ---------------------------------------------------------------------------

export type DimGripId = 'dimline' | 'text' | 'leader' | 'arc';

export interface DimensionLayout {
  readonly value: number;
  readonly text: string;
  readonly lines: readonly (readonly [Vec2, Vec2])[];
  readonly arcs: readonly { center: Vec2; radius: number; startDeg: number; sweepDeg: number }[];
  /** Arrowheads: tip position and the direction the arrow points (degrees). */
  readonly arrows: readonly { tip: Vec2; dirDeg: number }[];
  readonly textPos: Vec2;
  /** Text baseline direction, always readable (-90°, 90°]. */
  readonly textRotationDeg: number;
  /** Text height in drawing mm (from the paper size and the drawing scale). */
  readonly textHeight: number;
  readonly arrowSize: number;
  readonly grips: readonly { id: DimGripId; position: Vec2 }[];
}

const readable = (deg: number): number => {
  let a = normalizeAngle(deg);
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};

interface WorldSizes {
  h: number;
  arrow: number;
  gap: number;
  over: number;
  textGap: number;
}

const sizes = (style: DimensionStyle, scale: DrawingScale): WorldSizes => {
  const h = pageLengthToWorld(style.textHeightMm, scale);
  return {
    h,
    arrow: pageLengthToWorld(style.arrowSizeMm, scale),
    gap: pageLengthToWorld(style.extensionGapMm, scale),
    over: pageLengthToWorld(style.extensionOvershootMm, scale),
    textGap: h * 0.4,
  };
};

/** Text placed beside (above) a line through `mid` in direction `dirDeg`. */
function textBeside(mid: Vec2, dirDeg: number, w: WorldSizes): { pos: Vec2; rot: number } {
  const rot = readable(dirDeg);
  const up = rotateVec(vec(0, 1), rot);
  return { pos: add(mid, mul(up, w.textGap + w.h / 2)), rot };
}

export function layoutDimension(doc: DocLike, dim: Dimension, scale: DrawingScale): DimensionLayout | null {
  const value = measureDimension(doc, dim);
  if (value === null) return null;
  const w = sizes(dim.style, scale);
  const text = formatDimensionValue(dim, value, dim.style.decimals);
  const base = { value, text, textHeight: w.h, arrowSize: w.arrow };

  switch (dim.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical': {
      const f = linearFrame(doc, dim)!;
      const lines: [Vec2, Vec2][] = [];
      if (dim.style.showExtensionLines) {
        for (const [p, foot] of [
          [f.p1, f.f1],
          [f.p2, f.f2],
        ] as const) {
          const v = sub(foot, p);
          const l = length(v);
          if (l > w.gap) {
            const u = mul(v, 1 / l);
            lines.push([add(p, mul(u, w.gap)), add(foot, mul(u, w.over))]);
          }
        }
      }
      lines.push([f.f1, f.f2]);
      const span = distance(f.f1, f.f2);
      const dd = span > EPSILON ? mul(sub(f.f2, f.f1), 1 / span) : f.d;
      const ddDeg = (Math.atan2(dd.y, dd.x) * 180) / Math.PI;
      const arrows = span > EPSILON ? [{ tip: f.f1, dirDeg: ddDeg + 180 }, { tip: f.f2, dirDeg: ddDeg }] : [];
      const mid = midpoint(f.f1, f.f2);
      const t = textBeside(add(mid, mul(dd, dim.textShift)), ddDeg, w);
      return {
        ...base,
        lines,
        arcs: [],
        arrows,
        textPos: t.pos,
        textRotationDeg: t.rot,
        grips: [
          { id: 'dimline', position: mid },
          { id: 'text', position: t.pos },
        ],
      };
    }
    case 'radius':
    case 'diameter': {
      const c = doc.shapes.find((s) => s.id === dim.circleId);
      if (!c || c.kind !== 'circle') return null;
      const u = dirVec(dim.angleDeg);
      const q = add(c.center, mul(u, c.radius));
      if (dim.kind === 'radius') {
        const t = textBeside(add(midpoint(c.center, q), mul(u, dim.textShift)), dim.angleDeg, w);
        return {
          ...base,
          lines: [[c.center, q]],
          arcs: [],
          arrows: c.radius > EPSILON ? [{ tip: q, dirDeg: dim.angleDeg }] : [],
          textPos: t.pos,
          textRotationDeg: t.rot,
          grips: [{ id: 'leader', position: q }],
        };
      }
      const q1 = sub(c.center, mul(u, c.radius));
      const t = textBeside(add(c.center, mul(u, dim.textShift)), dim.angleDeg, w);
      return {
        ...base,
        lines: [[q1, q]],
        arcs: [],
        arrows: c.radius > EPSILON ? [{ tip: q, dirDeg: dim.angleDeg }, { tip: q1, dirDeg: dim.angleDeg + 180 }] : [],
        textPos: t.pos,
        textRotationDeg: t.rot,
        grips: [{ id: 'leader', position: q }],
      };
    }
    case 'angular': {
      const f = angularFrame(doc, dim)!;
      const R = dim.radius;
      const lines: [Vec2, Vec2][] = [];
      if (dim.style.showExtensionLines) {
        for (const [ray, l] of [
          [f.a1, f.l1],
          [f.a2, f.l2],
        ] as const) {
          const reach = Math.max(dot(sub(l.start, f.vertex), ray), dot(sub(l.end, f.vertex), ray), 0);
          if (reach + w.gap < R) lines.push([add(f.vertex, mul(ray, reach + w.gap)), add(f.vertex, mul(ray, R + w.over))]);
        }
      }
      const end = f.startDeg + f.sweepDeg;
      const midDeg = f.startDeg + f.sweepDeg / 2 + (R > EPSILON ? (dim.textShift / R) * (180 / Math.PI) : 0);
      const up = dirVec(midDeg);
      return {
        ...base,
        lines,
        arcs: [{ center: f.vertex, radius: R, startDeg: f.startDeg, sweepDeg: f.sweepDeg }],
        arrows:
          f.sweepDeg > 1e-9
            ? [
                { tip: add(f.vertex, mul(dirVec(f.startDeg), R)), dirDeg: f.startDeg - 90 },
                { tip: add(f.vertex, mul(dirVec(end), R)), dirDeg: end + 90 },
              ]
            : [],
        textPos: add(f.vertex, mul(up, R + w.textGap + w.h / 2)),
        textRotationDeg: readable(midDeg - 90),
        grips: [{ id: 'arc', position: add(f.vertex, mul(dirVec(f.startDeg + f.sweepDeg / 2), R)) }],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** Distance (drawing mm) from p to the visible parts of a dimension layout. */
export function distanceToDimensionLayout(l: DimensionLayout, p: Vec2): number {
  let d = Infinity;
  for (const [a, b] of l.lines) d = Math.min(d, distanceToSegment(p, a, b));
  for (const arc of l.arcs) {
    const ang = normalizeAngle(angleBetweenPoints(arc.center, p) - arc.startDeg);
    if (ang <= arc.sweepDeg) d = Math.min(d, Math.abs(distance(p, arc.center) - arc.radius));
  }
  // Text box (approximate glyph width 0.6 × height).
  const local = rotateVec(sub(p, l.textPos), -l.textRotationDeg);
  const halfW = (l.text.length * 0.6 * l.textHeight) / 2;
  const halfH = l.textHeight / 2;
  const dx = Math.max(0, Math.abs(local.x) - halfW);
  const dy = Math.max(0, Math.abs(local.y) - halfH);
  return Math.min(d, Math.hypot(dx, dy));
}

/** Topmost dimension within tolerance of p. */
export function hitTestDimensions(doc: DrawingDocument, p: Vec2, tolerance: number): Dimension | null {
  for (let i = doc.dimensions.length - 1; i >= 0; i--) {
    const l = layoutDimension(doc, doc.dimensions[i], doc.scale);
    if (l && distanceToDimensionLayout(l, p) <= tolerance) return doc.dimensions[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Creation and editing
// ---------------------------------------------------------------------------

export type DimResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function createLinearDimension(
  doc: DocLike,
  id: ShapeId,
  kind: LinearDimension['kind'],
  p1: DimAnchor,
  p2: DimAnchor,
  placement: Vec2,
  style: DimensionStyle,
): DimResult<LinearDimension> {
  const a = resolveAnchor(doc, p1);
  const b = resolveAnchor(doc, p2);
  if (!a || !b) return { ok: false, message: 'Dimension point is not on existing geometry' };
  const draft: LinearDimension = { id, kind, mode: 'driven', style, textShift: 0, p1, p2, offset: 0 };
  const f = linearFrame(doc, draft)!;
  if (f.value < 1e-9) {
    return { ok: false, message: kind === 'aligned' ? 'The two points coincide – nothing to measure' : `The points have no ${kind} separation` };
  }
  return { ok: true, value: { ...draft, offset: dot(sub(placement, a), f.n) } };
}

export function createRadialDimension(
  doc: DocLike,
  id: ShapeId,
  kind: RadialDimension['kind'],
  circleId: ShapeId,
  pick: Vec2,
  style: DimensionStyle,
): DimResult<RadialDimension> {
  const c = doc.shapes.find((s) => s.id === circleId);
  if (!c || c.kind !== 'circle') return { ok: false, message: 'Radius and diameter dimensions need a circle' };
  if (c.radius < 1e-9) return { ok: false, message: 'Circle has zero radius' };
  const angleDeg = distance(pick, c.center) < EPSILON ? 45 : angleBetweenPoints(c.center, pick);
  return { ok: true, value: { id, kind, mode: 'driven', style, textShift: 0, circleId, angleDeg } };
}

/** Express w in the (non-orthogonal) basis d1, d2: w = μ1 d1 + μ2 d2. */
function signsFor(w: Vec2, d1: Vec2, d2: Vec2): [1 | -1, 1 | -1] {
  const det = cross(d1, d2);
  const m1 = cross(w, d2) / det;
  const m2 = cross(d1, w) / det;
  return [m1 >= 0 ? 1 : -1, m2 >= 0 ? 1 : -1];
}

export function createAngularDimension(
  doc: DocLike,
  id: ShapeId,
  line1Id: ShapeId,
  line2Id: ShapeId,
  placement: Vec2,
  style: DimensionStyle,
): DimResult<AngularDimension> {
  if (line1Id === line2Id) return { ok: false, message: 'Pick two different lines' };
  const l1 = findLine(doc, line1Id);
  const l2 = findLine(doc, line2Id);
  if (!l1 || !l2) return { ok: false, message: 'Angular dimensions need two lines' };
  const hit = lineLineIntersection(l1.start, l1.end, l2.start, l2.end);
  if (!hit) return { ok: false, message: 'The lines are parallel (or zero length) – there is no angle to measure' };
  const w = sub(placement, hit.point);
  const radius = length(w);
  if (radius < 1e-9) return { ok: false, message: 'Place the dimension away from the vertex' };
  const [sign1, sign2] = signsFor(w, sub(l1.end, l1.start), sub(l2.end, l2.start));
  return { ok: true, value: { id, kind: 'angular', mode: 'driven', style, textShift: 0, line1Id, line2Id, sign1, sign2, radius } };
}

/** Drag a dimension grip to world point q (placement edits only – never changes the measured geometry). */
export function applyDimensionGrip(doc: DocLike, dim: Dimension, grip: DimGripId, q: Vec2): Dimension {
  switch (dim.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical': {
      const f = linearFrame(doc, dim);
      if (!f) return dim;
      if (grip === 'dimline') return { ...dim, offset: dot(sub(q, f.p1), f.n) };
      if (grip === 'text') return { ...dim, textShift: dot(sub(q, midpoint(f.f1, f.f2)), f.d) };
      return dim;
    }
    case 'radius':
    case 'diameter': {
      const c = doc.shapes.find((s) => s.id === dim.circleId);
      if (!c || c.kind !== 'circle' || grip !== 'leader' || distance(q, c.center) < EPSILON) return dim;
      return { ...dim, angleDeg: angleBetweenPoints(c.center, q) };
    }
    case 'angular': {
      const f = angularFrame(doc, dim);
      if (!f || grip !== 'arc') return dim;
      const w = sub(q, f.vertex);
      if (length(w) < 1e-9) return dim;
      const [sign1, sign2] = signsFor(w, sub(f.l1.end, f.l1.start), sub(f.l2.end, f.l2.start));
      return { ...dim, sign1, sign2, radius: length(w) };
    }
  }
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** Shapes a dimension is linked to. */
export function dimensionShapeIds(dim: Dimension): ShapeId[] {
  switch (dim.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical':
      return [dim.p1, dim.p2].flatMap((a) => (a.kind === 'shape' ? [a.shapeId] : []));
    case 'radius':
    case 'diameter':
      return [dim.circleId];
    case 'angular':
      return [dim.line1Id, dim.line2Id];
  }
}

/** Human-readable link status for the properties panel. */
export function describeLinks(doc: DocLike, dim: Dimension): string {
  const ids = dimensionShapeIds(dim);
  const fixed = dim.kind === 'aligned' || dim.kind === 'horizontal' || dim.kind === 'vertical' ? [dim.p1, dim.p2].filter((a) => a.kind === 'point').length : 0;
  const missing = ids.filter((id) => !doc.shapes.some((s) => s.id === id)).length;
  const parts: string[] = [];
  if (ids.length) parts.push(`${ids.length} linked point${ids.length === 1 ? '' : 's'}${missing ? ` (${missing} missing)` : ''}`);
  if (fixed) parts.push(`${fixed} fixed point${fixed === 1 ? '' : 's'}`);
  return parts.join(', ') || '—';
}

/** Move the FIXED points of a dimension (linked points follow their geometry automatically). */
export function moveDimension(dim: Dimension, dx: number, dy: number): Dimension {
  if (dim.kind !== 'aligned' && dim.kind !== 'horizontal' && dim.kind !== 'vertical') return dim;
  const mv = (a: DimAnchor): DimAnchor => (a.kind === 'point' ? { kind: 'point', point: vec(a.point.x + dx, a.point.y + dy) } : a);
  return { ...dim, p1: mv(dim.p1), p2: mv(dim.p2) };
}

/** Point a linked anchor at a different shape/key (used when an edit splits geometry). */
export function retargetAnchors(dims: readonly Dimension[], from: { shapeId: ShapeId; key: string }, to: { shapeId: ShapeId; key: string }): Dimension[] {
  const fix = (a: DimAnchor): DimAnchor =>
    a.kind === 'shape' && a.shapeId === from.shapeId && a.key === from.key ? { kind: 'shape', shapeId: to.shapeId, key: to.key } : a;
  return dims.map((d) => (d.kind === 'aligned' || d.kind === 'horizontal' || d.kind === 'vertical' ? { ...d, p1: fix(d.p1), p2: fix(d.p2) } : d));
}

/**
 * Copy dimensions alongside duplicated shapes: links are re-pointed at the copies,
 * fixed points are offset. A dimension linked to a shape that was NOT copied is
 * skipped (its copy would sit on the original geometry).
 */
export function copyDimensions(
  dims: readonly Dimension[],
  idMap: ReadonlyMap<ShapeId, ShapeId>,
  newId: () => ShapeId,
  offset: Vec2,
): Dimension[] {
  const out: Dimension[] = [];
  for (const d of dims) {
    if (!dimensionShapeIds(d).every((id) => idMap.has(id))) continue;
    const m = (id: ShapeId) => idMap.get(id)!;
    switch (d.kind) {
      case 'aligned':
      case 'horizontal':
      case 'vertical': {
        const a = (x: DimAnchor): DimAnchor =>
          x.kind === 'shape' ? { ...x, shapeId: m(x.shapeId) } : { kind: 'point', point: add(x.point, offset) };
        out.push({ ...d, id: newId(), p1: a(d.p1), p2: a(d.p2) });
        break;
      }
      case 'radius':
      case 'diameter':
        out.push({ ...d, id: newId(), circleId: m(d.circleId) });
        break;
      case 'angular':
        out.push({ ...d, id: newId(), line1Id: m(d.line1Id), line2Id: m(d.line2Id) });
        break;
    }
  }
  return out;
}
