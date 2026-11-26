import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { shapeKeyPoints, shapePrimitives } from '../src/model/anchors';
import { createEmptyDocument } from '../src/model/document';
import { applyHandleDrag, getSelectionFrame } from '../src/model/handles';
import { distanceToShape } from '../src/model/hitTest';
import { offsetShape, trimPreviewShape, trimShape } from '../src/model/modify';
import { createLine, createPolygon, createPolyline, polylineArea, polylineLength, regularPolygonPoints } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument, type PolylineShape, type Shape } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/documentStorage';
import { newSession, toolClick, toolFinish, toolPreview, toolUndoPoint, type ToolSession } from '../src/ui/interaction/toolSession';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
let n = 0;
const newId = () => `n${++n}`;
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { message: string }).message);
  return r as Extract<T, { ok: true }>;
};
const get = (d: DrawingDocument, id: string) => d.shapes.find((s) => s.id === id) as PolylineShape;
const pts = (p: PolylineShape) => p.points.map((q) => [Math.round(q.x * 1e9) / 1e9, Math.round(q.y * 1e9) / 1e9]);

// 40 × 20 closed rectangle-shaped polyline, and an open zig-zag
const SQ = createPolyline('SQ', [vec(0, 0), vec(40, 0), vec(40, 20), vec(0, 20)], undefined, true);
const ZZ = createPolyline('ZZ', [vec(0, 0), vec(10, 0), vec(10, 10), vec(20, 10)]);

describe('closed polylines and polygons', () => {
  it('a closed polyline includes the closing segment everywhere', () => {
    expect(polylineLength(SQ)).toBe(120);
    expect(polylineArea(SQ)).toBe(800);
    expect(polylineLength(ZZ)).toBe(30);
    expect(polylineArea(ZZ)).toBe(0);
    expect(distanceToShape(SQ, vec(-1, 10))).toBe(1); // on the closing edge x = 0
    expect(shapePrimitives(SQ)).toHaveLength(4);
    expect(shapeKeyPoints(SQ).find((k) => k.key === 'sm3')?.point).toEqual(vec(0, 10));
  });
  it('regular polygons: exact corners, across-flats, validation', () => {
    const hex = regularPolygonPoints(vec(0, 0), 10, 6, 0);
    expect(hex[0]).toEqual(vec(10, 0));
    expect(hex[3].x).toBeCloseTo(-10, 12);
    const P = createPolygon('P', vec(5, 5), 10, 6);
    expect(P.closed).toBe(true);
    expect(P.points).toHaveLength(6);
    expect(polylineArea(P)).toBeCloseTo((3 * Math.sqrt(3) / 2) * 100, 9);
    expect(() => regularPolygonPoints(vec(0, 0), 10, 2)).toThrow();
    expect(() => regularPolygonPoints(vec(0, 0), 0, 5)).toThrow();
  });
  it('offsetting a closed polyline gives a closed polyline with mitred corners all round', () => {
    const r = ok(offsetShape(docOf(SQ), 'SQ', 5, vec(-10, 10), newId));
    const o = r.doc.shapes[1] as PolylineShape;
    expect(o.closed).toBe(true);
    expect(pts(o).sort()).toEqual([[-5, -5], [-5, 25], [45, -5], [45, 25]].sort());
    const inner = ok(offsetShape(docOf(SQ), 'SQ', 5, vec(20, 10), newId)).doc.shapes[1] as PolylineShape;
    expect(polylineArea(inner)).toBeCloseTo(30 * 10, 9);
  });
  it('inner vertices have grips; dragging one moves exactly that vertex', () => {
    const f = getSelectionFrame([ZZ], 5);
    expect(f.handles.map((h) => h.id)).toEqual(expect.arrayContaining(['start', 'v1', 'v2', 'end']));
    const [moved] = applyHandleDrag([ZZ], f, 'v2', vec(10, 10), vec(12, 15), {}) as PolylineShape[];
    expect(moved.points[2]).toEqual(vec(12, 15));
    expect(moved.points[1]).toEqual(vec(10, 0));
  });
  it('closed flag survives save/load; old files stay open; a closed polyline needs 3 points', () => {
    const text = serializeProject(docOf(SQ, ZZ));
    const back = parseProject(text).doc;
    expect(get(back, 'SQ').closed).toBe(true);
    expect('closed' in get(back, 'ZZ')).toBe(false);
    const bad = JSON.parse(text);
    bad.shapes[0].points = bad.shapes[0].points.slice(0, 2);
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/shapes\[0\]\.points.*at least 3/);
  });
});

describe('trimming polylines', () => {
  const V = createLine('V', vec(15, -5), vec(15, 15)); // crosses ZZ's last segment at (15, 10)
  it('trims the end beyond a cutting edge', () => {
    const r = ok(trimShape(docOf(ZZ, V), 'ZZ', vec(18, 10), newId));
    expect(pts(get(r.doc, 'ZZ'))).toEqual([[0, 0], [10, 0], [10, 10], [15, 10]]);
  });
  it('trims the start side, keeping the far end', () => {
    const r = ok(trimShape(docOf(ZZ, V), 'ZZ', vec(5, 0), newId));
    expect(pts(get(r.doc, 'ZZ'))).toEqual([[15, 10], [20, 10]]);
  });
  it('splits in two when the picked part lies between two cuts', () => {
    const W = createLine('W', vec(5, -5), vec(5, 5)); // crosses the first segment at (5, 0)
    const r = ok(trimShape(docOf(ZZ, V, W), 'ZZ', vec(10, 5), newId));
    expect(r.selection).toHaveLength(2);
    expect(pts(get(r.doc, 'ZZ'))).toEqual([[0, 0], [5, 0]]);
    expect(pts(get(r.doc, r.selection[1]))).toEqual([[15, 10], [20, 10]]);
  });
  it('a closed polyline crossed twice opens up, the picked side removed', () => {
    const X = createLine('X', vec(20, -5), vec(20, 25)); // crosses bottom at (20,0) and top at (20,20)
    const prev = trimPreviewShape(docOf(SQ, X), 'SQ', vec(40, 10)) as PolylineShape;
    expect(polylineLength(prev)).toBeCloseTo(60, 9); // right half: 20 + 20 + 20
    const r = ok(trimShape(docOf(SQ, X), 'SQ', vec(40, 10), newId));
    const left = get(r.doc, 'SQ');
    expect(left.closed).toBeUndefined();
    expect(polylineLength(left)).toBeCloseTo(60, 9);
    expect(pts(left)).toEqual([[20, 20], [0, 20], [0, 0], [20, 0]]);
  });
  it('refusals: nothing crossing; a closed polyline crossed once', () => {
    expect(trimShape(docOf(ZZ), 'ZZ', vec(5, 0), newId).ok).toBe(false);
    const T = createLine('T', vec(20, 10), vec(20, 30)); // crosses the top edge only
    const r = trimShape(docOf(SQ, T), 'SQ', vec(40, 10), newId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at least two places/);
  });
});

describe('polyline and polygon tools', () => {
  const base = { doc: createEmptyDocument(), selection: [], snap: null, tolerance: 1, dimStyle: DEFAULT_DIMENSION_STYLE, offsetDistanceMm: 5, mirrorKeepSource: true, newId: () => 'PL' };
  const click = (s: ToolSession, x: number, y: number) => toolClick(s, { ...base, raw: vec(x, y), point: vec(x, y) });
  it('clicks add points; Backspace removes the last; Enter finishes an open polyline', () => {
    let s = newSession('polyline');
    for (const [x, y] of [[0, 0], [10, 0], [10, 10], [99, 99]]) s = click(s, x, y).session;
    s = toolUndoPoint(s)!;
    expect(s.points).toHaveLength(3);
    expect(click(s, 10, 10).kind).toBe('continue'); // a repeated click (double-click) adds nothing
    expect(click(s, 10, 10).session.points).toHaveLength(3);
    expect(toolPreview(s, { ...base, raw: vec(20, 10), point: vec(20, 10) }).shapes[0]).toMatchObject({ kind: 'polyline' });
    const done = toolFinish(s, { ...base, raw: vec(0, 0), point: vec(0, 0) })!;
    expect(done.kind).toBe('commit');
    if (done.kind === 'commit') expect(done.doc.shapes[0]).toMatchObject({ kind: 'polyline', points: [vec(0, 0), vec(10, 0), vec(10, 10)] });
    if (done.kind === 'commit') expect('closed' in done.doc.shapes[0]).toBe(false);
  });
  it('clicking the first point again closes it', () => {
    let s = newSession('polyline');
    for (const [x, y] of [[0, 0], [10, 0], [10, 10]]) s = click(s, x, y).session;
    const done = click(s, 0.4, 0.3);
    expect(done.kind).toBe('commit');
    if (done.kind === 'commit') expect(done.doc.shapes[0]).toMatchObject({ closed: true, points: [vec(0, 0), vec(10, 0), vec(10, 10)] });
  });
  it('a single point cannot be finished', () => {
    const s = click(newSession('polyline'), 0, 0).session;
    expect(toolFinish(s, { ...base, raw: vec(0, 0), point: vec(0, 0) })!.kind).toBe('error');
    expect(toolFinish(newSession('polyline'), { ...base, raw: vec(0, 0), point: vec(0, 0) })).toBeNull();
  });
  it('polygon tool: centre, then a corner (sets radius and rotation)', () => {
    const s = toolClick(newSession('polygon'), { ...base, polygonSides: 5, raw: vec(0, 0), point: vec(0, 0) }).session;
    const done = toolClick(s, { ...base, polygonSides: 5, raw: vec(0, 10), point: vec(0, 10) });
    expect(done.kind).toBe('commit');
    if (done.kind === 'commit') {
      const p = done.doc.shapes[0] as PolylineShape;
      expect(p.points).toHaveLength(5);
      expect(p.points[0].x).toBeCloseTo(0, 12);
      expect(p.points[0].y).toBeCloseTo(10, 12);
      expect(p.closed).toBe(true);
    }
  });
});
