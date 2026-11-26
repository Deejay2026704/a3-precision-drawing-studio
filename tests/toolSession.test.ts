import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { measureDimension } from '../src/model/dimensions';
import { findSnap, DEFAULT_SNAP_SETTINGS } from '../src/model/snap';
import { createCircle, createLine } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument, type LineShape } from '../src/model/types';
import { newSession, toolClick, toolPreview, type SessionTool, type ToolInput, type ToolSession, type ToolStep } from '../src/ui/interaction/toolSession';

let n = 0;
const base: Omit<ToolInput, 'point' | 'raw' | 'snap' | 'doc'> = {
  selection: [],
  tolerance: 1,
  dimStyle: DEFAULT_DIMENSION_STYLE,
  offsetDistanceMm: 5,
  mirrorKeepSource: true,
  newId: () => `n${++n}`,
};

/** Simulate a sequence of clicks with real snapping. */
function clicks(doc: DrawingDocument, tool: SessionTool, pts: { x: number; y: number }[], selection: string[] = []): ToolStep {
  let s: ToolSession = newSession(tool);
  let step: ToolStep | null = null;
  let sel = selection;
  for (const raw of pts) {
    const snap = findSnap(raw, DEFAULT_SNAP_SETTINGS, { shapes: doc.shapes, tolerance: 1, basePoint: s.points[0] });
    step = toolClick(s, { ...base, doc, selection: sel, raw, point: snap?.point ?? raw, snap });
    s = step.session;
    if (step.kind === 'continue' && step.selection) sel = [...step.selection];
  }
  return step!;
}

const L = createLine('L', vec(0, 0), vec(100, 0));
const V = createLine('V', vec(0, 0), vec(0, 50));
const C = createCircle('C', vec(200, 0), 20);
const doc: DrawingDocument = { ...createEmptyDocument(), shapes: [L, V, C] };

describe('tool workflows (click sequences with real snapping)', () => {
  it('aligned dimension: endpoint snaps become linked anchors', () => {
    const r = clicks(doc, 'dim-aligned', [vec(0.3, 0.2), vec(99.6, 0.4), vec(50, -15)]);
    expect(r.kind).toBe('commit');
    if (r.kind !== 'commit') return;
    const d = r.doc.dimensions[0];
    expect(d.kind === 'aligned' && d.p1).toEqual({ kind: 'shape', shapeId: 'L', key: 'start' });
    expect(measureDimension(r.doc, d)).toBe(100);
    // linked: lengthen the line and the dimension follows
    const longer = { ...r.doc, shapes: r.doc.shapes.map((s) => (s.id === 'L' ? { ...(s as LineShape), end: vec(130, 0) } : s)) };
    expect(measureDimension(longer, d)).toBe(130);
  });

  it('dimension between free points uses fixed (grid-snapped) anchors', () => {
    const r = clicks({ ...doc, shapes: [] }, 'dim-horizontal', [vec(10.2, 9.9), vec(35.4, 40), vec(20, 60)]); // 1 mm grid snap → 10 and 35
    expect(r.kind === 'commit' && measureDimension(r.doc, r.doc.dimensions[0])).toBe(25);
  });

  it('radius / diameter / angular', () => {
    const rad = clicks(doc, 'dim-radius', [vec(220, 0.5)]);
    expect(rad.kind === 'commit' && measureDimension(rad.doc, rad.doc.dimensions[0])).toBe(20);
    const dia = clicks(doc, 'dim-diameter', [vec(200, 20.3)]);
    expect(dia.kind === 'commit' && measureDimension(dia.doc, dia.doc.dimensions[0])).toBe(40);
    const ang = clicks(doc, 'dim-angular', [vec(50, 0.2), vec(0.3, 30), vec(20, 20)]);
    expect(ang.kind === 'commit' && measureDimension(ang.doc, ang.doc.dimensions[0])).toBeCloseTo(90, 10);
  });

  it('wrong picks are refused with a message and keep the session', () => {
    expect(clicks(doc, 'dim-radius', [vec(50, 0)])).toMatchObject({ kind: 'error', message: 'Click on a circle or an arc' });
    const par = { ...doc, shapes: [L, createLine('P', vec(0, 10), vec(100, 10))] };
    expect(clicks(par, 'dim-angular', [vec(50, 0), vec(50, 10), vec(20, 5)]).kind).toBe('error');
    expect(clicks(doc, 'dim-aligned', [vec(0, 0), vec(0.2, 0.1)]).kind).toBe('error');
    expect(clicks(doc, 'trim', [vec(500, 500)]).kind).toBe('error');
  });

  it('trim, extend, offset and mirror through clicks', () => {
    const cross = createLine('X', vec(60, -10), vec(60, 10));
    const t = clicks({ ...doc, shapes: [L, cross] }, 'trim', [vec(80, 0.2)]);
    expect(t.kind === 'commit' && t.doc.shapes[0]).toMatchObject({ end: vec(60, 0) });
    const e = clicks({ ...doc, shapes: [createLine('S', vec(0, 0), vec(10, 0)), cross] }, 'extend', [vec(9, 0.2)]);
    expect(e.kind === 'commit' && e.doc.shapes[0]).toMatchObject({ end: vec(60, 0) });
    const o = clicks(doc, 'offset', [vec(50, 0.3), vec(50, 7)]);
    expect(o.kind === 'commit' && o.doc.shapes[3]).toMatchObject({ start: vec(0, 5), end: vec(100, 5) });
    const m = clicks(doc, 'mirror', [vec(200.5, 20.2), vec(300, 0), vec(300, 100)]);
    expect(m.kind === 'commit' && m.doc.shapes[3]).toMatchObject({ kind: 'circle', center: vec(400, 0) });
  });

  it('previews never modify the document', () => {
    const before = JSON.stringify(doc);
    const s = { ...newSession('mirror' as const), points: [vec(300, 0)] };
    const p = toolPreview(s, { ...base, doc, selection: ['C'], raw: vec(300, 100), point: vec(300, 100), snap: null });
    expect(p.shapes.length).toBe(2);
    expect(JSON.stringify(doc)).toBe(before);
    const tp = toolPreview(newSession('trim'), { ...base, doc: { ...doc, shapes: [L, createLine('X', vec(60, -10), vec(60, 10))] }, raw: vec(80, 0), point: vec(80, 0), snap: null });
    expect(tp.removedShapes).toHaveLength(1);
    expect(tp.removedShapes[0]).toMatchObject({ kind: 'line', start: vec(60, 0), end: vec(100, 0) });
  });
});

describe('Milestone 3: constraint tools and locked layers in tool workflows', () => {
  const X = createLine('X', vec(10, 10), vec(50, 10));
  const Y = createLine('Y', vec(52, 13), vec(80, 40));
  const d2: DrawingDocument = { ...createEmptyDocument(), shapes: [X, Y] };

  it('coincident tool: two point picks join the points exactly', () => {
    let s = newSession('con-coincident');
    let step = toolClick(s, { ...base, doc: d2, raw: vec(50.3, 10.2), point: vec(50.3, 10.2), snap: null });
    expect(step.kind).toBe('continue');
    s = step.session;
    step = toolClick(s, { ...base, doc: d2, raw: vec(52.2, 12.8), point: vec(52.2, 12.8), snap: null });
    expect(step.kind).toBe('commit');
    if (step.kind !== 'commit') return;
    const [x, y] = step.doc.shapes as LineShape[];
    expect(Math.hypot(x.end.x - y.start.x, x.end.y - y.start.y)).toBeLessThan(1e-6);
  });

  it('fixed-position tool pins a point where it is; picking empty space is refused', () => {
    const step = toolClick(newSession('con-fixed-position'), { ...base, doc: d2, raw: vec(10.2, 9.9), point: vec(10.2, 9.9), snap: null });
    expect(step.kind === 'commit' && step.doc.constraints[0]).toMatchObject({ kind: 'fixed-position', x: 10, y: 10 });
    expect(toolClick(newSession('con-fixed-position'), { ...base, doc: d2, raw: vec(200, 200), point: vec(200, 200), snap: null }).kind).toBe('error');
  });

  it('modify tools refuse objects that are not editable (locked/hidden layer)', () => {
    const cross = createLine('Z', vec(30, 0), vec(30, 20));
    const doc3: DrawingDocument = { ...createEmptyDocument(), shapes: [X, cross] };
    const locked = (sh: { id: string }) => sh.id !== 'X';
    const r = toolClick(newSession('trim'), { ...base, doc: doc3, raw: vec(45, 10.1), point: vec(45, 10.1), snap: null, canEdit: locked });
    expect(r.kind).toBe('error');
    const o = toolClick(newSession('offset'), { ...base, doc: doc3, raw: vec(45, 10.1), point: vec(45, 10.1), snap: null, canEdit: locked });
    expect(o.kind).toBe('error');
  });
});
