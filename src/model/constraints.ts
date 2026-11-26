import { normalizeAngle } from '../geometry/angles';
import { formatNumber } from '../geometry/units';
import { distance, vec, type Vec2 } from '../geometry/vec';
import { constraintShapeIds, isEditable } from './layers';
import { CONSTRAINT_LABELS, type CircleShape, type Constraint, type ConstraintKind, type DrawingDocument, type LineShape, type PointRef, type Shape, type ShapeId } from './types';

/**
 * DRIVING geometric constraints and a numerical solver.
 *
 * Unknowns are the defining values of constrained lines (start, end) and circles
 * (centre, radius). Each constraint contributes residual equations that are zero
 * when it is satisfied. The solver is a damped, weighted minimum-change Gauss–Newton
 * (Levenberg–Marquardt) method: it satisfies the constraints while moving the geometry
 * as little as possible, preferring to keep just-edited objects where the user put them.
 *
 * Guarantees:
 *  - objects on locked or hidden layers are never moved;
 *  - a result that collapses a line or circle to zero size is rejected (no distortion);
 *  - if the constraints cannot all be met, the document is returned UNCHANGED and the
 *    constraints that remain unmet are reported – nothing is claimed to be satisfied;
 *  - status is always computed from the actual geometry (`constraintStatus`).
 */
export { constraintShapeIds };

/** Residual tolerance for reporting a constraint as satisfied (mm, or radians for angles). */
export const STATUS_TOL = 1e-6;
const SOLVE_TOL = 1e-10;
const MIN_SIZE = 1e-6;
/** Solver changes smaller than this (mm) are treated as no change. */
const NOISE = 1e-9;

export type ConstraintStatus = 'satisfied' | 'unsatisfied' | 'suppressed' | 'broken';

export const CONSTRAINT_GLYPHS: Record<ConstraintKind, string> = {
  horizontal: 'H',
  vertical: 'V',
  coincident: '◉',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: 'T',
  'equal-length': '=',
  'fixed-length': 'L',
  'fixed-angle': '∠',
  'fixed-position': '⊕',
};

/** Shape kinds the constraint system supports. Rectangles and polylines are not constrainable. */
export const isConstrainable = (s: Shape): s is LineShape | CircleShape => s.kind === 'line' || s.kind === 'circle';

// ---------------------------------------------------------------------------
// Validation of references
// ---------------------------------------------------------------------------

const find = (doc: Pick<DrawingDocument, 'shapes'>, id: ShapeId) => doc.shapes.find((s) => s.id === id);
const lineLen = (l: LineShape) => distance(l.start, l.end);

function needLine(doc: Pick<DrawingDocument, 'shapes'>, id: ShapeId): string | null {
  const s = find(doc, id);
  if (!s) return 'references an object that no longer exists';
  if (s.kind !== 'line') return 'needs a line';
  if (lineLen(s) < MIN_SIZE) return 'cannot use a zero-length line';
  return null;
}

function needPoint(doc: Pick<DrawingDocument, 'shapes'>, p: PointRef): string | null {
  const s = find(doc, p.shapeId);
  if (!s) return 'references an object that no longer exists';
  if (s.kind === 'line' && (p.key === 'start' || p.key === 'end' || p.key === 'mid')) return null;
  if (s.kind === 'circle' && p.key === 'center') return null;
  return 'needs a line end/midpoint or a circle centre';
}

/** Why a constraint is not valid for the document (null = valid). */
export function constraintProblem(doc: Pick<DrawingDocument, 'shapes'>, c: Constraint): string | null {
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
    case 'fixed-length':
    case 'fixed-angle':
      if (c.kind === 'fixed-length' && !(c.value > 0)) return 'length must be greater than zero';
      return needLine(doc, c.line);
    case 'parallel':
    case 'perpendicular':
    case 'equal-length':
      if (c.a === c.b) return 'needs two different lines';
      return needLine(doc, c.a) ?? needLine(doc, c.b);
    case 'tangent': {
      if (c.a === c.b) return 'needs two different objects';
      const a = find(doc, c.a);
      const b = find(doc, c.b);
      if (!a || !b) return 'references an object that no longer exists';
      if (b.kind !== 'circle' || (a.kind !== 'line' && a.kind !== 'circle')) return 'needs a line and a circle, or two circles';
      if (b.radius < MIN_SIZE || (a.kind === 'circle' && a.radius < MIN_SIZE)) return 'cannot use a zero-radius circle';
      if (a.kind === 'line' && lineLen(a) < MIN_SIZE) return 'cannot use a zero-length line';
      return null;
    }
    case 'coincident':
      if (c.p.shapeId === c.q.shapeId && c.p.key === c.q.key) return 'needs two different points';
      if (c.p.shapeId === c.q.shapeId) return 'needs points on two different objects';
      return needPoint(doc, c.p) ?? needPoint(doc, c.q);
    case 'fixed-position':
      return needPoint(doc, c.p);
  }
}

// ---------------------------------------------------------------------------
// Residuals
// ---------------------------------------------------------------------------

interface Geo {
  line(id: ShapeId): { s: Vec2; e: Vec2 };
  circle(id: ShapeId): { c: Vec2; r: number };
  point(p: PointRef): Vec2;
}

const DEGENERATE = 1; // residual used when a direction is undefined: never "satisfied"

function unitOf(s: Vec2, e: Vec2): Vec2 | null {
  const l = Math.hypot(e.x - s.x, e.y - s.y);
  return l < 1e-12 ? null : vec((e.x - s.x) / l, (e.y - s.y) / l);
}

function residuals(c: Constraint, g: GeoWithKind): number[] {
  switch (c.kind) {
    case 'horizontal': {
      const L = g.line(c.line);
      return [L.e.y - L.s.y];
    }
    case 'vertical': {
      const L = g.line(c.line);
      return [L.e.x - L.s.x];
    }
    case 'fixed-length': {
      const L = g.line(c.line);
      return [distance(L.s, L.e) - c.value];
    }
    case 'fixed-angle': {
      const L = g.line(c.line);
      const dx = L.e.x - L.s.x;
      const dy = L.e.y - L.s.y;
      if (Math.hypot(dx, dy) < 1e-12) return [DEGENERATE];
      const t = (c.value * Math.PI) / 180;
      const cr = Math.cos(t) * dy - Math.sin(t) * dx;
      const dt = Math.cos(t) * dx + Math.sin(t) * dy;
      return [Math.atan2(cr, dt)]; // signed angular error (radians)
    }
    case 'parallel':
    case 'perpendicular': {
      const A = g.line(c.a);
      const B = g.line(c.b);
      const u = unitOf(A.s, A.e);
      const v = unitOf(B.s, B.e);
      if (!u || !v) return [DEGENERATE];
      return [c.kind === 'parallel' ? u.x * v.y - u.y * v.x : u.x * v.x + u.y * v.y];
    }
    case 'equal-length': {
      const A = g.line(c.a);
      const B = g.line(c.b);
      return [distance(A.s, A.e) - distance(B.s, B.e)];
    }
    case 'tangent': {
      const C = g.circle(c.b);
      if (isLineRef(g, c.a)) {
        const L = g.line(c.a);
        const len = distance(L.s, L.e);
        if (len < 1e-12) return [DEGENERATE];
        const cross = (L.e.x - L.s.x) * (C.c.y - L.s.y) - (L.e.y - L.s.y) * (C.c.x - L.s.x);
        return [Math.abs(cross) / len - C.r];
      }
      const A = g.circle(c.a);
      const d = distance(A.c, C.c);
      return [c.internal ? d - Math.abs(A.r - C.r) : d - (A.r + C.r)];
    }
    case 'coincident': {
      const p = g.point(c.p);
      const q = g.point(c.q);
      return [p.x - q.x, p.y - q.y];
    }
    case 'fixed-position': {
      const p = g.point(c.p);
      return [p.x - c.x, p.y - c.y];
    }
  }
}

// `tangent` needs to know whether `a` is a line or a circle.
type GeoWithKind = Geo & { kindOf?: (id: ShapeId) => 'line' | 'circle' };
function isLineRef(g: GeoWithKind, id: ShapeId): boolean {
  return g.kindOf ? g.kindOf(id) === 'line' : true;
}

function docGeo(doc: Pick<DrawingDocument, 'shapes'>): GeoWithKind {
  const map = new Map(doc.shapes.map((s) => [s.id, s]));
  const line = (id: ShapeId) => {
    const s = map.get(id) as LineShape;
    return { s: s.start, e: s.end };
  };
  const circle = (id: ShapeId) => {
    const s = map.get(id) as CircleShape;
    return { c: s.center, r: s.radius };
  };
  return {
    line,
    circle,
    point: (p) => pointOf(map.get(p.shapeId)!, p.key),
    kindOf: (id) => (map.get(id)?.kind === 'circle' ? 'circle' : 'line'),
  };
}

function pointOf(s: Shape, key: PointRef['key']): Vec2 {
  if (s.kind === 'circle') return s.center;
  const l = s as LineShape;
  if (key === 'start') return l.start;
  if (key === 'end') return l.end;
  return vec((l.start.x + l.end.x) / 2, (l.start.y + l.end.y) / 2);
}

/** Current residuals of one constraint against the document geometry (null = broken refs). */
export function constraintResiduals(doc: Pick<DrawingDocument, 'shapes'>, c: Constraint): number[] | null {
  if (constraintProblem(doc, c) && !isOnlyZeroSize(doc, c)) return null;
  return residuals(c, docGeo(doc));
}
const isOnlyZeroSize = (doc: Pick<DrawingDocument, 'shapes'>, c: Constraint) => {
  const p = constraintProblem(doc, c);
  return p !== null && /zero-/.test(p) && constraintShapeIds(c).every((id) => find(doc, id));
};

export function constraintStatus(doc: Pick<DrawingDocument, 'shapes'>, c: Constraint): ConstraintStatus {
  if (c.suppressed) return 'suppressed';
  const r = constraintResiduals(doc, c);
  if (!r) return 'broken';
  return r.every((v) => Number.isFinite(v) && Math.abs(v) <= STATUS_TOL) ? 'satisfied' : 'unsatisfied';
}

export function constraintStatuses(doc: Pick<DrawingDocument, 'shapes' | 'constraints'>): Map<ShapeId, ConstraintStatus> {
  return new Map(doc.constraints.map((c) => [c.id, constraintStatus(doc, c)]));
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

interface SlotInfo {
  shape: LineShape | CircleShape;
  offset: number;
  free: boolean;
}

export interface SolveResult {
  readonly ok: boolean;
  /** Solved document (ok) or the INPUT document unchanged (not ok). */
  readonly doc: DrawingDocument;
  /** Active constraints that are not met (in the input when !ok). */
  readonly unsatisfied: readonly ShapeId[];
  readonly moved: readonly ShapeId[];
  readonly reason?: string;
}

function gauss(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-300) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f !== 0) for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const maxAbs = (r: number[]) => r.reduce((m, v) => Math.max(m, Number.isFinite(v) ? Math.abs(v) : Infinity), 0);
const sumSq = (r: number[]) => r.reduce((m, v) => m + v * v, 0);

export interface SolveOptions {
  /** Objects the user just edited: the solver prefers to move other objects. */
  readonly preferred?: ReadonlySet<ShapeId>;
  readonly maxIterations?: number;
}

export function activeConstraints(doc: DrawingDocument): Constraint[] {
  return doc.constraints.filter((c) => !c.suppressed && constraintProblem(doc, c) === null);
}

export function solveConstraints(doc: DrawingDocument, opts: SolveOptions = {}): SolveResult {
  // Sizes are more deliberate than positions: first try with every circle radius held
  // EXACTLY fixed; only if that cannot satisfy the constraints are radii allowed to change.
  const fixedRadii = solveOnce(doc, opts, false);
  if (fixedRadii.ok) return fixedRadii;
  const hasCircles = activeConstraints(doc).some((c) => constraintShapeIds(c).some((id) => find(doc, id)?.kind === 'circle'));
  return hasCircles ? solveOnce(doc, opts, true) : fixedRadii;
}

function solveOnce(doc: DrawingDocument, opts: SolveOptions, radiiFree: boolean): SolveResult {
  const cons = activeConstraints(doc);
  const unchanged = (ok: boolean, unsatisfied: ShapeId[], reason?: string): SolveResult => ({ ok, doc, unsatisfied, moved: [], reason });
  if (cons.length === 0) return unchanged(true, []);

  // Unknowns
  const slots = new Map<ShapeId, SlotInfo>();
  let n = 0;
  for (const c of cons) {
    for (const id of constraintShapeIds(c)) {
      if (slots.has(id)) continue;
      const s = find(doc, id) as LineShape | CircleShape;
      slots.set(id, { shape: s, offset: n, free: isEditable(doc, s) });
      n += s.kind === 'line' ? 4 : 3;
    }
  }
  const x0 = new Array<number>(n);
  for (const { shape: s, offset: o } of slots.values()) {
    if (s.kind === 'line') [x0[o], x0[o + 1], x0[o + 2], x0[o + 3]] = [s.start.x, s.start.y, s.end.x, s.end.y];
    else [x0[o], x0[o + 1], x0[o + 2]] = [s.center.x, s.center.y, s.radius];
  }
  const freeIdx: number[] = [];
  const weight: number[] = [];
  for (const { shape, offset, free } of slots.values()) {
    if (!free) continue;
    const w = opts.preferred?.has(shape.id) ? 1e4 : 1;
    for (let k = 0; k < (shape.kind === 'line' ? 4 : 3); k++) {
      if (shape.kind === 'circle' && k === 2 && !radiiFree) continue;
      freeIdx.push(offset + k);
      weight.push(w);
    }
  }

  const geoOf = (x: number[]): GeoWithKind => {
    const line = (id: ShapeId) => {
      const o = slots.get(id)!.offset;
      return { s: vec(x[o], x[o + 1]), e: vec(x[o + 2], x[o + 3]) };
    };
    const circle = (id: ShapeId) => {
      const o = slots.get(id)!.offset;
      return { c: vec(x[o], x[o + 1]), r: x[o + 2] };
    };
    return {
      line,
      circle,
      kindOf: (id) => slots.get(id)!.shape.kind as 'line' | 'circle',
      point: (p) => {
        const sl = slots.get(p.shapeId)!;
        if (sl.shape.kind === 'circle') return circle(p.shapeId).c;
        const L = line(p.shapeId);
        return p.key === 'start' ? L.s : p.key === 'end' ? L.e : vec((L.s.x + L.e.x) / 2, (L.s.y + L.e.y) / 2);
      },
    };
  };
  const R = (x: number[]) => cons.flatMap((c) => residuals(c, geoOf(x)));
  const perConstraint = (x: number[]) => cons.filter((c) => maxAbs(residuals(c, geoOf(x))) > STATUS_TOL).map((c) => c.id);

  let x = [...x0];
  let r = R(x);
  if (maxAbs(r) <= SOLVE_TOL) return unchanged(true, []);
  if (freeIdx.length === 0) return unchanged(false, perConstraint(x), 'The constrained objects are on locked or hidden layers');

  let lambda = 1e-12;
  const maxIter = opts.maxIterations ?? 200;
  for (let it = 0; it < maxIter && maxAbs(r) > SOLVE_TOL; it++) {
    // Numerical Jacobian over free unknowns (central differences).
    const m = r.length;
    const J: number[][] = Array.from({ length: m }, () => new Array<number>(freeIdx.length).fill(0));
    freeIdx.forEach((vi, j) => {
      const h = 1e-7 * Math.max(1, Math.abs(x[vi]));
      const xp = [...x];
      const xm = [...x];
      xp[vi] += h;
      xm[vi] -= h;
      const rp = R(xp);
      const rm = R(xm);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    });
    const f0 = sumSq(r);
    let improved = false;
    for (let attempt = 0; attempt < 14 && !improved; attempt++) {
      // Weighted minimum-change step: dx = -W⁻¹Jᵀ (J W⁻¹ Jᵀ + λI)⁻¹ r
      const A: number[][] = Array.from({ length: m }, (_, i) =>
        Array.from({ length: m }, (_, k) => {
          let s = 0;
          for (let j = 0; j < freeIdx.length; j++) s += (J[i][j] * J[k][j]) / weight[j];
          return s + (i === k ? lambda : 0);
        }),
      );
      const y = gauss(A, r);
      if (y) {
        const xn = [...x];
        freeIdx.forEach((vi, j) => {
          let s = 0;
          for (let i = 0; i < m; i++) s += J[i][j] * y[i];
          xn[vi] -= s / weight[j];
        });
        const rn = R(xn);
        if (sumSq(rn) < f0 && rn.every(Number.isFinite)) {
          x = xn;
          r = rn;
          lambda = Math.max(lambda / 10, 1e-15);
          improved = true;
          break;
        }
      }
      lambda *= 10;
    }
    if (!improved) break;
  }

  if (maxAbs(r) > SOLVE_TOL * 100) {
    return unchanged(false, perConstraint(x), 'The constraints conflict (or are unreachable) – geometry was not changed');
  }

  // Reject degenerate solutions (no silent collapse of geometry).
  for (const { shape: s, offset: o } of slots.values()) {
    if (s.kind === 'line') {
      const before = lineLen(s);
      const after = Math.hypot(x[o + 2] - x[o], x[o + 3] - x[o + 1]);
      if (before >= MIN_SIZE && after < MIN_SIZE) return unchanged(false, perConstraint(x0), 'The constraints would collapse a line to zero length');
    } else if (x[o + 2] < MIN_SIZE) {
      return unchanged(false, perConstraint(x0), 'The constraints would give a circle zero or negative radius');
    }
  }

  // Write back (only free shapes can have changed).
  const moved: ShapeId[] = [];
  const updated = new Map<ShapeId, Shape>();
  for (const { shape: s, offset: o, free } of slots.values()) {
    if (!free) continue;
    const next: Shape =
      s.kind === 'line'
        ? { ...s, start: vec(x[o], x[o + 1]), end: vec(x[o + 2], x[o + 3]) }
        : { ...s, center: vec(x[o], x[o + 1]), radius: x[o + 2] };
    // Changes below NOISE are floating-point noise: the object is left exactly as it was.
    const count = s.kind === 'line' ? 4 : 3;
    let changed = false;
    for (let q = 0; q < count; q++) if (Math.abs(x[o + q] - x0[o + q]) > NOISE) changed = true;
    if (changed) {
      updated.set(s.id, next);
      moved.push(s.id);
    }
  }
  const solved = updated.size ? { ...doc, shapes: doc.shapes.map((s) => updated.get(s.id) ?? s) } : doc;
  return { ok: true, doc: solved, unsatisfied: [], moved };
}

// ---------------------------------------------------------------------------
// Editing API
// ---------------------------------------------------------------------------

export type ConstraintResult = { ok: true; doc: DrawingDocument; message: string } | { ok: false; message: string; conflicts?: readonly ShapeId[] };

export function describeConstraint(doc: Pick<DrawingDocument, 'shapes'>, c: Constraint): string {
  void doc; // reserved for object names
  const v = c.kind === 'fixed-length' ? ` ${formatNumber(c.value)} mm` : c.kind === 'fixed-angle' ? ` ${formatNumber(c.value)}°` : c.kind === 'fixed-position' ? ` (${formatNumber(c.x)}, ${formatNumber(c.y)})` : '';
  return `${CONSTRAINT_LABELS[c.kind]}${v}`;
}

const sameRefs = (a: Constraint, b: Constraint): boolean => {
  if (a.kind !== b.kind) return false;
  const ids = (c: Constraint) => JSON.stringify([...constraintShapeIds(c)].sort()) + (c.kind === 'coincident' ? JSON.stringify([c.p.key, c.q.key].sort()) : c.kind === 'fixed-position' ? c.p.key : '');
  return ids(a) === ids(b);
};

function labelsOf(doc: DrawingDocument, ids: readonly ShapeId[]): string {
  return ids
    .map((id) => doc.constraints.find((c) => c.id === id))
    .filter((c): c is Constraint => !!c)
    .map((c) => describeConstraint(doc, c))
    .join(', ');
}

/** Add a constraint and solve. Refused (document unchanged) if invalid, duplicate or conflicting. */
export function addConstraint(doc: DrawingDocument, c: Constraint): ConstraintResult {
  const problem = constraintProblem(doc, c);
  if (problem) return { ok: false, message: `${CONSTRAINT_LABELS[c.kind]} ${problem}` };
  if (doc.constraints.some((x) => !x.suppressed && sameRefs(x, c))) return { ok: false, message: `That ${CONSTRAINT_LABELS[c.kind].toLowerCase()} constraint already exists` };
  const withC = { ...doc, constraints: [...doc.constraints, c] };
  const r = solveConstraints(withC, { preferred: new Set() });
  if (!r.ok) {
    const others = r.unsatisfied.filter((id) => id !== c.id);
    return {
      ok: false,
      conflicts: r.unsatisfied,
      message: `Cannot add ${CONSTRAINT_LABELS[c.kind].toLowerCase()}: ${r.reason ?? 'conflicts with existing constraints'}${others.length ? ` (${labelsOf(withC, others)})` : ''}`,
    };
  }
  return { ok: true, doc: r.doc, message: `${describeConstraint(doc, c)} constraint added${r.moved.length ? ` – ${r.moved.length} object${r.moved.length === 1 ? '' : 's'} adjusted` : ''}` };
}

/** Change a constraint (value / suppression). Refused, document unchanged, if it cannot be satisfied. */
export function updateConstraint(doc: DrawingDocument, c: Constraint): ConstraintResult {
  if (!doc.constraints.some((x) => x.id === c.id)) return { ok: false, message: 'Constraint not found' };
  if (c.kind === 'fixed-length' && !(c.value > 0)) return { ok: false, message: 'Length must be greater than zero' };
  const next = { ...doc, constraints: doc.constraints.map((x) => (x.id === c.id ? c : x)) };
  if (c.suppressed) return { ok: true, doc: next, message: `${describeConstraint(doc, c)} suppressed` };
  const r = solveConstraints(next);
  if (!r.ok) return { ok: false, conflicts: r.unsatisfied, message: `Not applied: ${r.reason ?? 'conflicts with other constraints'}` };
  return { ok: true, doc: r.doc, message: `${describeConstraint(doc, c)} applied` };
}

/** Build a constraint of `kind` from selected shapes (null + reason if the selection does not fit). */
export function constraintFromSelection(kind: ConstraintKind, shapes: readonly Shape[], id: ShapeId): Constraint | string {
  const lines = shapes.filter((s): s is LineShape => s.kind === 'line');
  const circles = shapes.filter((s): s is CircleShape => s.kind === 'circle');
  const base = { id, suppressed: false };
  switch (kind) {
    case 'horizontal':
    case 'vertical':
    case 'fixed-length':
    case 'fixed-angle': {
      if (shapes.length !== 1 || lines.length !== 1) return 'Select exactly one line';
      const l = lines[0];
      if (kind === 'fixed-length') return { ...base, kind, line: l.id, value: lineLen(l) };
      if (kind === 'fixed-angle') {
        let a = normalizeAngle((Math.atan2(l.end.y - l.start.y, l.end.x - l.start.x) * 180) / Math.PI);
        if (a > 180) a -= 360;
        return { ...base, kind, line: l.id, value: a };
      }
      return { ...base, kind, line: l.id };
    }
    case 'parallel':
    case 'perpendicular':
    case 'equal-length':
      if (shapes.length !== 2 || lines.length !== 2) return 'Select exactly two lines';
      return { ...base, kind, a: lines[0].id, b: lines[1].id };
    case 'tangent': {
      if (shapes.length !== 2 || circles.length === 0) return 'Select a line and a circle, or two circles';
      if (lines.length === 1) return { ...base, kind, a: lines[0].id, b: circles[0].id, internal: false };
      const [a, b] = circles;
      const internal = distance(a.center, b.center) < Math.max(a.radius, b.radius);
      return { ...base, kind, a: a.id, b: b.id, internal };
    }
    case 'coincident':
    case 'fixed-position':
      return 'Pick points with the tool';
  }
}

/** World anchors for on-canvas constraint markers (one per referenced object). */
export function constraintMarkerAnchors(doc: Pick<DrawingDocument, 'shapes'>, c: Constraint): Vec2[] {
  const at = (id: ShapeId): Vec2 | null => {
    const s = find(doc, id);
    if (!s) return null;
    if (s.kind === 'line') return vec((s.start.x + s.end.x) / 2, (s.start.y + s.end.y) / 2);
    if (s.kind === 'circle') return vec(s.center.x, s.center.y + s.radius);
    return null;
  };
  const pt = (p: PointRef): Vec2 | null => {
    const s = find(doc, p.shapeId);
    return s && (s.kind === 'line' || s.kind === 'circle') ? pointOf(s, p.key) : null;
  };
  const list = c.kind === 'coincident' ? [pt(c.p)] : c.kind === 'fixed-position' ? [pt(c.p)] : constraintShapeIds(c).map(at);
  return list.filter((p): p is Vec2 => p !== null);
}
