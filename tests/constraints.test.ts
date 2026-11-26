import { describe, expect, it } from 'vitest';
import { distance, vec } from '../src/geometry/vec';
import { createEmptyDocument, removeItems } from '../src/model/document';
import {
  addConstraint,
  constraintFromSelection,
  constraintStatus,
  constraintStatuses,
  solveConstraints,
  updateConstraint,
  type ConstraintResult,
} from '../src/model/constraints';
import { addLayer, setLayerProps, type LayerResult } from '../src/model/layers';
import { createArc, createCircle, createLine, lineAngle, lineLength } from '../src/model/shapes';
import { arcStart } from '../src/model/arcs';
import { parseProject, serializeProject } from '../src/storage/documentStorage';
import type { ArcShape, CircleShape, Constraint, DrawingDocument, LineShape, Shape } from '../src/model/types';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
const ok = (r: ConstraintResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.doc;
};
const line = (d: DrawingDocument, id: string) => d.shapes.find((s) => s.id === id) as LineShape;
const circle = (d: DrawingDocument, id: string) => d.shapes.find((s) => s.id === id) as CircleShape;
const base = { suppressed: false };
const TOL = 1e-6;

const A = createLine('A', vec(0, 0), vec(100, 3));
const B = createLine('B', vec(10, 20), vec(60, 75));
const C = createCircle('C', vec(50, 50), 10);
const C2 = createCircle('C2', vec(90, 52), 15);

describe('each constraint type is solved exactly', () => {
  it('horizontal / vertical', () => {
    const h = ok(addConstraint(docOf(A), { ...base, id: 'k', kind: 'horizontal', line: 'A' }));
    expect(line(h, 'A').start.y).toBeCloseTo(line(h, 'A').end.y, 9);
    const v = ok(addConstraint(docOf(B), { ...base, id: 'k', kind: 'vertical', line: 'B' }));
    expect(line(v, 'B').start.x).toBeCloseTo(line(v, 'B').end.x, 9);
  });

  it('minimum change: horizontal moves both ends half-way, keeps the length close', () => {
    const h = ok(addConstraint(docOf(A), { ...base, id: 'k', kind: 'horizontal', line: 'A' }));
    expect(line(h, 'A').start.y).toBeCloseTo(1.5, 6);
    expect(line(h, 'A').start.x).toBeCloseTo(0, 6);
  });

  it('coincident', () => {
    const d = ok(addConstraint(docOf(A, B), { ...base, id: 'k', kind: 'coincident', p: { shapeId: 'A', key: 'end' }, q: { shapeId: 'B', key: 'start' } }));
    expect(distance(line(d, 'A').end, line(d, 'B').start)).toBeLessThan(TOL);
  });

  it('parallel and perpendicular', () => {
    const p = ok(addConstraint(docOf(A, B), { ...base, id: 'k', kind: 'parallel', a: 'A', b: 'B' }));
    const da = lineAngle(line(p, 'A'));
    const db = lineAngle(line(p, 'B'));
    expect(Math.abs(Math.sin(((da - db) * Math.PI) / 180))).toBeLessThan(TOL);
    const q = ok(addConstraint(docOf(A, B), { ...base, id: 'k', kind: 'perpendicular', a: 'A', b: 'B' }));
    expect(Math.abs(Math.cos(((lineAngle(line(q, 'A')) - lineAngle(line(q, 'B'))) * Math.PI) / 180))).toBeLessThan(TOL);
  });

  it('tangent: line–circle and circle–circle (external)', () => {
    const t = ok(addConstraint(docOf(A, C), { ...base, id: 'k', kind: 'tangent', a: 'A', b: 'C', internal: false }));
    const L = line(t, 'A');
    const c = circle(t, 'C');
    const dist = Math.abs((L.end.x - L.start.x) * (c.center.y - L.start.y) - (L.end.y - L.start.y) * (c.center.x - L.start.x)) / lineLength(L);
    expect(dist - c.radius).toBeLessThan(TOL);
    const cc = ok(addConstraint(docOf(C, C2), { ...base, id: 'k', kind: 'tangent', a: 'C', b: 'C2', internal: false }));
    const [c1, c2] = [circle(cc, 'C'), circle(cc, 'C2')];
    expect(Math.abs(distance(c1.center, c2.center) - (c1.radius + c2.radius))).toBeLessThan(TOL);
    // positions move; sizes are held EXACTLY when that is possible
    expect(c1.radius).toBe(10);
    expect(c2.radius).toBe(15);
  });

  it('equal length, fixed length, fixed angle, fixed position', () => {
    const e = ok(addConstraint(docOf(A, B), { ...base, id: 'k', kind: 'equal-length', a: 'A', b: 'B' }));
    expect(Math.abs(lineLength(line(e, 'A')) - lineLength(line(e, 'B')))).toBeLessThan(TOL);
    const fl = ok(addConstraint(docOf(A), { ...base, id: 'k', kind: 'fixed-length', line: 'A', value: 80 }));
    expect(lineLength(line(fl, 'A'))).toBeCloseTo(80, 6);
    const fa = ok(addConstraint(docOf(A), { ...base, id: 'k', kind: 'fixed-angle', line: 'A', value: 30 }));
    expect(lineAngle(line(fa, 'A'))).toBeCloseTo(30, 6);
    const fp = ok(addConstraint(docOf(C), { ...base, id: 'k', kind: 'fixed-position', p: { shapeId: 'C', key: 'center' }, x: 12.5, y: -3 }));
    expect(distance(circle(fp, 'C').center, vec(12.5, -3))).toBeLessThan(TOL);
    expect(circle(fp, 'C').radius).toBe(10);
  });

  it('a rectangle-like system: H, V, coincident corners, fixed lengths', () => {
    let d = docOf(createLine('b', vec(0, 0), vec(98, 2)), createLine('r', vec(99, 1), vec(101, 52)), createLine('t', vec(100, 50), vec(1, 49)), createLine('l', vec(0, 51), vec(1, -1)));
    const cs: Constraint[] = [
      { ...base, id: 'h1', kind: 'horizontal', line: 'b' },
      { ...base, id: 'h2', kind: 'horizontal', line: 't' },
      { ...base, id: 'v1', kind: 'vertical', line: 'r' },
      { ...base, id: 'v2', kind: 'vertical', line: 'l' },
      { ...base, id: 'c1', kind: 'coincident', p: { shapeId: 'b', key: 'end' }, q: { shapeId: 'r', key: 'start' } },
      { ...base, id: 'c2', kind: 'coincident', p: { shapeId: 'r', key: 'end' }, q: { shapeId: 't', key: 'start' } },
      { ...base, id: 'c3', kind: 'coincident', p: { shapeId: 't', key: 'end' }, q: { shapeId: 'l', key: 'start' } },
      { ...base, id: 'c4', kind: 'coincident', p: { shapeId: 'l', key: 'end' }, q: { shapeId: 'b', key: 'start' } },
      { ...base, id: 'w', kind: 'fixed-length', line: 'b', value: 120 },
      { ...base, id: 'hh', kind: 'fixed-length', line: 'r', value: 60 },
      { ...base, id: 'o', kind: 'fixed-position', p: { shapeId: 'b', key: 'start' }, x: 10, y: 10 },
    ];
    for (const c of cs) d = ok(addConstraint(d, c));
    expect(line(d, 'b').start.x).toBeCloseTo(10, 6);
    expect(line(d, 'b').end.x).toBeCloseTo(130, 6);
    expect(line(d, 't').start.y).toBeCloseTo(70, 6);
    expect([...constraintStatuses(d).values()].every((s) => s === 'satisfied')).toBe(true);
  });
});

describe('sizes and unrelated geometry', () => {
  it('line–circle tangency keeps the radius exactly', () => {
    const t = ok(addConstraint(docOf(A, C), { ...base, id: 'k', kind: 'tangent', a: 'A', b: 'C', internal: false }));
    expect(circle(t, 'C').radius).toBe(10);
  });

  it('a radius changes only when nothing else can satisfy the constraints', () => {
    // both centres pinned 20 apart: external tangency needs r1 + r2 = 20, so radii must change
    let d = docOf(createCircle('P', vec(0, 0), 5), createCircle('Q', vec(20, 0), 5));
    d = ok(addConstraint(d, { ...base, id: 'f1', kind: 'fixed-position', p: { shapeId: 'P', key: 'center' }, x: 0, y: 0 }));
    d = ok(addConstraint(d, { ...base, id: 'f2', kind: 'fixed-position', p: { shapeId: 'Q', key: 'center' }, x: 20, y: 0 }));
    d = ok(addConstraint(d, { ...base, id: 't', kind: 'tangent', a: 'P', b: 'Q', internal: false }));
    expect(circle(d, 'P').radius + circle(d, 'Q').radius).toBeCloseTo(20, 6);
  });

  it('objects that need no change are returned untouched (same object, not re-created)', () => {
    let d = ok(addConstraint(docOf(A, B, C), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    const cBefore = d.shapes.find((s) => s.id === 'C');
    const bBefore = d.shapes.find((s) => s.id === 'B');
    d = ok(addConstraint(d, { ...base, id: 't', kind: 'tangent', a: 'A', b: 'C', internal: false }));
    expect(d.shapes.find((s) => s.id === 'B')).toBe(bBefore); // not involved
    expect(d.shapes.find((s) => s.id === 'C')).not.toBe(cBefore); // moved to become tangent
  });
});

describe('conflicts, invalid input and safety', () => {
  it('a conflicting constraint is refused and the geometry is left untouched', () => {
    const d = ok(addConstraint(docOf(A), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    const r = addConstraint(d, { ...base, id: 'a', kind: 'fixed-angle', line: 'A', value: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Cannot add fixed angle/);
    expect(d.constraints).toHaveLength(1);
  });

  it('horizontal + vertical on one line would collapse it: refused, not distorted', () => {
    const d = ok(addConstraint(docOf(A), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    const r = addConstraint(d, { ...base, id: 'v', kind: 'vertical', line: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/collapse|conflict/);
  });

  it('two fixed positions for the same point at different places conflict', () => {
    const d = ok(addConstraint(docOf(C), { ...base, id: 'f1', kind: 'fixed-position', p: { shapeId: 'C', key: 'center' }, x: 0, y: 0 }));
    expect(addConstraint(d, { ...base, id: 'f2', kind: 'fixed-position', p: { shapeId: 'C', key: 'center' }, x: 5, y: 0 }).ok).toBe(false);
  });

  it('duplicates, wrong object kinds, same object twice and zero-length lines are refused', () => {
    const d = ok(addConstraint(docOf(A, C), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    expect(addConstraint(d, { ...base, id: 'h2', kind: 'horizontal', line: 'A' }).ok).toBe(false);
    expect(addConstraint(d, { ...base, id: 'x', kind: 'horizontal', line: 'C' }).ok).toBe(false);
    expect(addConstraint(d, { ...base, id: 'x', kind: 'parallel', a: 'A', b: 'A' }).ok).toBe(false);
    expect(addConstraint(docOf(createLine('Z', vec(1, 1), vec(1, 1))), { ...base, id: 'x', kind: 'horizontal', line: 'Z' }).ok).toBe(false);
    expect(addConstraint(d, { ...base, id: 'x', kind: 'fixed-length', line: 'A', value: 0 }).ok).toBe(false);
  });

  it('parallel lines can be made parallel (redundant but consistent constraints converge)', () => {
    let d = ok(addConstraint(docOf(A, B), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    d = ok(addConstraint(d, { ...base, id: 'h2', kind: 'horizontal', line: 'B' }));
    d = ok(addConstraint(d, { ...base, id: 'p', kind: 'parallel', a: 'A', b: 'B' }));
    expect(constraintStatus(d, d.constraints[2])).toBe('satisfied');
  });

  it('objects on locked layers are never moved by the solver', () => {
    const withLayer = (r: LayerResult) => {
      if (!r.ok) throw new Error(r.message);
      return r.doc;
    };
    let d = docOf({ ...A, layerId: 'K' }, B);
    d = withLayer(addLayer(d, 'K', 'Locked'));
    d = withLayer(setLayerProps(d, 'K', { locked: true }));
    const r = ok(addConstraint(d, { ...base, id: 'p', kind: 'parallel', a: 'A', b: 'B' }));
    expect(line(r, 'A')).toEqual({ ...A, layerId: 'K' }); // locked line untouched
    expect(Math.abs(lineAngle(line(r, 'B')) - lineAngle(A)) % 180).toBeLessThan(1e-4);
    // a constraint that would need the locked line to move is refused
    expect(addConstraint(d, { ...base, id: 'h', kind: 'horizontal', line: 'A' }).ok).toBe(false);
  });

  it('status is computed from geometry: editing geometry can make a constraint unsatisfied', () => {
    const d = ok(addConstraint(docOf(A), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    expect(constraintStatus(d, d.constraints[0])).toBe('satisfied');
    const bent = { ...d, shapes: d.shapes.map((s) => (s.kind === 'line' ? { ...s, end: vec(100, 50) } : s)) };
    expect(constraintStatus(bent, bent.constraints[0])).toBe('unsatisfied');
  });

  it('suppressed constraints are ignored; unsuppressing re-solves or is refused', () => {
    let d = ok(addConstraint(docOf(A), { ...base, id: 'h', kind: 'horizontal', line: 'A' }));
    d = ok(updateConstraint(d, { ...d.constraints[0], suppressed: true }));
    expect(constraintStatus(d, d.constraints[0])).toBe('suppressed');
    d = ok(addConstraint(d, { ...base, id: 'a', kind: 'fixed-angle', line: 'A', value: 45 }));
    expect(lineAngle(line(d, 'A'))).toBeCloseTo(45, 6);
    expect(updateConstraint(d, { ...d.constraints[0], suppressed: false }).ok).toBe(false);
  });

  it('editing a value re-solves; an impossible value is refused', () => {
    let d = ok(addConstraint(docOf(A), { ...base, id: 'f', kind: 'fixed-length', line: 'A', value: 50 }));
    d = ok(updateConstraint(d, { ...(d.constraints[0] as Extract<Constraint, { kind: 'fixed-length' }>), value: 72.25 }));
    expect(lineLength(line(d, 'A'))).toBeCloseTo(72.25, 6);
    expect(updateConstraint(d, { ...(d.constraints[0] as Extract<Constraint, { kind: 'fixed-length' }>), value: -1 }).ok).toBe(false);
  });

  it('missing geometry → "broken", never "satisfied"', () => {
    const d = ok(addConstraint(docOf(A, B), { ...base, id: 'p', kind: 'parallel', a: 'A', b: 'B' }));
    const gone = { ...d, shapes: d.shapes.filter((s) => s.id !== 'B') };
    expect(constraintStatus(gone, d.constraints[0])).toBe('broken');
    expect(solveConstraints(gone).ok).toBe(true); // broken constraints are skipped, nothing moves
  });

  it('deleting geometry removes its constraints (counted)', () => {
    const d = ok(addConstraint(docOf(A, B), { ...base, id: 'p', kind: 'parallel', a: 'A', b: 'B' }));
    const r = removeItems(d, ['B']);
    expect(r.doc.constraints).toHaveLength(0);
    expect(r.dependentConstraints).toBe(1);
  });

  it('preferred (just-edited) objects stay put; the other object moves', () => {
    const d = { ...docOf(A, B), constraints: [{ ...base, id: 'p', kind: 'parallel' as const, a: 'A', b: 'B' }] };
    const r = solveConstraints(d, { preferred: new Set(['A']) });
    expect(r.ok).toBe(true);
    expect(Math.abs(lineAngle(line(r.doc, 'A')) - lineAngle(A))).toBeLessThan(0.01);
  });
});

describe('constraints from a selection', () => {
  it('builds valid constraints or explains what to select', () => {
    expect(constraintFromSelection('horizontal', [A], 'k')).toMatchObject({ kind: 'horizontal', line: 'A' });
    expect(constraintFromSelection('fixed-length', [A], 'k')).toMatchObject({ value: lineLength(A) });
    expect(constraintFromSelection('parallel', [A], 'k')).toBe('Select exactly two lines');
    expect(constraintFromSelection('tangent', [A, C], 'k')).toMatchObject({ a: 'A', b: 'C' });
    expect(constraintFromSelection('tangent', [createCircle('s', vec(0, 0), 2), createCircle('t', vec(0, 0.5), 10)], 'k')).toMatchObject({ internal: true });
    expect(constraintFromSelection('tangent', [A, B], 'k')).toMatch(/circle/);
  });
});

describe('Milestone 5: radius and line-angle constraints, arcs in the solver', () => {
  const ARC = createArc('ARC', vec(50, 50), 20, 0, 120);

  it('fixed radius: circle and arc follow an edited value exactly; centres stay put', () => {
    let d = ok(addConstraint(docOf(C), { ...base, id: 'r', kind: 'fixed-radius', shape: 'C', value: 10 }));
    d = ok(updateConstraint(d, { ...base, id: 'r', kind: 'fixed-radius', shape: 'C', value: 17.5 }));
    expect(circle(d, 'C')).toMatchObject({ radius: expect.closeTo(17.5, 9), center: vec(50, 50) });
    let a = ok(addConstraint(docOf(ARC), { ...base, id: 'r', kind: 'fixed-radius', shape: 'ARC', value: 20 }));
    a = ok(updateConstraint(a, { ...base, id: 'r', kind: 'fixed-radius', shape: 'ARC', value: 32 }));
    const arc = a.shapes[0] as ArcShape;
    expect(arc.radius).toBeCloseTo(32, 9);
    expect(arc.sweepDeg).toBeCloseTo(120, 6);
    expect(constraintStatus(a, a.constraints[0])).toBe('satisfied');
  });

  it('angle between two lines: created at the current angle, edited exactly', () => {
    const c = constraintFromSelection('angle', [A, B], 'g');
    expect(typeof c).not.toBe('string');
    let d = ok(addConstraint(docOf(A, B), c as Constraint));
    d = ok(updateConstraint(d, { ...(c as Extract<Constraint, { kind: 'angle' }>), value: 60 }));
    const a = line(d, 'A');
    const b = line(d, 'B');
    const ang = (Math.acos(((a.end.x - a.start.x) * (b.end.x - b.start.x) + (a.end.y - a.start.y) * (b.end.y - b.start.y)) / (lineLength(a) * lineLength(b))) * 180) / Math.PI;
    expect(ang).toBeCloseTo(60, 6);
  });

  it('conflicts are refused: angle 30° on lines that are also parallel', () => {
    const d = ok(addConstraint(docOf(A, B), { ...base, id: 'p', kind: 'parallel', a: 'A', b: 'B' }));
    expect(addConstraint(d, { ...base, id: 'g', kind: 'angle', a: 'A', b: 'B', value: 30 }).ok).toBe(false);
    expect(addConstraint(docOf(A, B), { ...base, id: 'g', kind: 'angle', a: 'A', b: 'B', value: 200 }).ok).toBe(false);
    expect(addConstraint(docOf(A), { ...base, id: 'r', kind: 'fixed-radius', shape: 'A', value: 5 }).ok).toBe(false);
  });

  it('line tangent to an arc (radius kept); coincident line end ↔ arc start; pinned arc centre', () => {
    const L = createLine('L', vec(0, 0), vec(100, 5));
    let d = ok(addConstraint(docOf(L, ARC), { ...base, id: 't', kind: 'tangent', a: 'L', b: 'ARC', internal: false }));
    const arc = d.shapes.find((s) => s.id === 'ARC') as ArcShape;
    const l = line(d, 'L');
    const dist = Math.abs((l.end.x - l.start.x) * (arc.center.y - l.start.y) - (l.end.y - l.start.y) * (arc.center.x - l.start.x)) / lineLength(l);
    expect(dist).toBeCloseTo(arc.radius, 6);
    expect(arc.radius).toBe(20);
    d = ok(addConstraint(docOf(L, ARC), { ...base, id: 'k', kind: 'coincident', p: { shapeId: 'L', key: 'end' }, q: { shapeId: 'ARC', key: 'start' } }));
    const a2 = d.shapes.find((s) => s.id === 'ARC') as ArcShape;
    expect(distance(line(d, 'L').end, arcStart(a2))).toBeLessThan(1e-6);
    d = ok(addConstraint(docOf(ARC), { ...base, id: 'f', kind: 'fixed-position', p: { shapeId: 'ARC', key: 'center' }, x: 0, y: 0 }));
    expect(distance((d.shapes[0] as ArcShape).center, vec(0, 0))).toBeLessThan(1e-6);
  });

  it('round-trip of the new constraint kinds through the file format', () => {
    const d = { ...docOf({ ...A, layerId: 'layer-0' }, { ...B, layerId: 'layer-0' }, { ...ARC, layerId: 'layer-0' }), constraints: [
      { ...base, id: 'r', kind: 'fixed-radius' as const, shape: 'ARC', value: 20 },
      { ...base, id: 'g', kind: 'angle' as const, a: 'A', b: 'B', value: 42.5 },
    ] };
    expect(parseProject(serializeProject(d)).doc).toEqual(d);
    const bad = JSON.parse(serializeProject(d));
    bad.constraints[1].value = 181;
    expect(() => parseProject(JSON.stringify(bad))).toThrow('constraints[1].value');
  });
});
