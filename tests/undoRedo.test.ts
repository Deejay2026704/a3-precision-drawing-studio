import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { addDimensions } from '../src/model/document';
import { applyDimensionGrip, createLinearDimension, createRadialDimension } from '../src/model/dimensions';
import { extendLine, mirrorShapes, offsetShape, trimLine, type EditResult } from '../src/model/modify';
import { createCircle, createLine } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE as S } from '../src/model/types';
import { createInitialState, editorReducer, type EditorAction, type EditorState } from '../src/ui/state/editorReducer';

const run = (s: EditorState, ...a: EditorAction[]) => a.reduce(editorReducer, s);
let n = 0;
const newId = () => `id${++n}`;

const onLayer = <T>(x: T): T => ({ ...x, layerId: 'layer-0' });
const L = onLayer(createLine('L', vec(0, 0), vec(100, 0)));
const A = onLayer(createLine('A', vec(30, -10), vec(30, 10)));
const W = onLayer(createLine('W', vec(150, -10), vec(150, 10)));
const C = onLayer(createCircle('C', vec(50, 60), 20));

const start = () => run(createInitialState(), { type: 'addShapes', shapes: [L, A, W, C] });

/** Apply an EditResult through the reducer, then check undo restores and redo re-applies exactly. */
function roundTrip(label: string, make: (s: EditorState) => EditResult | { doc: EditorState['doc']; message: string }) {
  it(`${label}: one undo step, exact undo and redo`, () => {
    const s0 = start();
    const r = make(s0);
    if ('ok' in r && !r.ok) throw new Error(r.message);
    const s1 = run(s0, { type: 'commitDocument', doc: r.doc, message: r.message });
    expect(s1.doc).not.toBe(s0.doc);
    expect(s1.past).toHaveLength(s0.past.length + 1);
    const u = run(s1, { type: 'undo' });
    expect(u.doc).toEqual(s0.doc);
    const re = run(u, { type: 'redo' });
    expect(re.doc).toEqual(s1.doc);
  });
}

describe('undo / redo for every Milestone 2 operation', () => {
  roundTrip('trim (end)', (s) => trimLine(s.doc, 'L', vec(10, 0), newId));
  roundTrip('trim (split)', (s) => trimLine({ ...s.doc, shapes: [...s.doc.shapes, createLine('B', vec(60, -5), vec(60, 5))] }, 'L', vec(45, 0), newId));
  roundTrip('extend', (s) => extendLine(s.doc, 'L', vec(99, 0)));
  roundTrip('offset', (s) => offsetShape(s.doc, 'C', 5, vec(0, 0), newId));
  roundTrip('mirror (copy)', (s) => mirrorShapes(s.doc, ['L', 'C'], vec(0, 200), vec(10, 200), true, newId));
  roundTrip('mirror (replace)', (s) => mirrorShapes(s.doc, ['C'], vec(0, 200), vec(10, 200), false, newId));
  roundTrip('add dimension', (s) => {
    const d = createLinearDimension(s.doc, 'D', 'aligned', { kind: 'shape', shapeId: 'L', key: 'start' }, { kind: 'shape', shapeId: 'L', key: 'end' }, vec(50, 20), S);
    if (!d.ok) throw new Error(d.message);
    return { doc: addDimensions(s.doc, [d.value]), message: 'dim' };
  });

  it('dimension grip edits and style changes undo', () => {
    const d = createRadialDimension(start().doc, 'R', 'radius', 'C', vec(80, 60), S);
    if (!d.ok) throw new Error(d.message);
    const s1 = run(start(), { type: 'commitDocument', doc: addDimensions(start().doc, [d.value]), message: '' });
    const turned = applyDimensionGrip(s1.doc, d.value, 'leader', vec(50, 100));
    const s2 = run(s1, { type: 'updateDimensions', dimensions: [{ ...turned, style: { ...S, decimals: 0 } }] });
    expect(s2.doc.dimensions[0]).toMatchObject({ angleDeg: 90 });
    const u = run(s2, { type: 'undo' });
    expect(u.doc.dimensions[0]).toEqual({ ...d.value, layerId: 'layer-0' });
  });

  it('deleting a shape with dependent dimensions is one step; undo restores both', () => {
    const d = createRadialDimension(start().doc, 'R', 'radius', 'C', vec(80, 60), S);
    if (!d.ok) throw new Error(d.message);
    const s1 = run(start(), { type: 'commitDocument', doc: addDimensions(start().doc, [d.value]), message: '' }, { type: 'setSelection', ids: ['C'] });
    const s2 = run(s1, { type: 'deleteSelection' });
    expect(s2.doc.dimensions).toHaveLength(0);
    expect(s2.message).toMatch(/1 dependent dimension/);
    const u = run(s2, { type: 'undo' });
    expect(u.doc).toEqual(s1.doc);
  });

  it('a long mixed sequence undoes back to the start and redoes to the end', () => {
    let s = start();
    const states = [s.doc];
    const ops: ((st: EditorState) => EditResult)[] = [
      (st) => trimLine(st.doc, 'L', vec(10, 0), newId),
      (st) => extendLine(st.doc, 'L', vec(99, 0)),
      (st) => offsetShape(st.doc, 'A', 3, vec(40, 0), newId),
      (st) => mirrorShapes(st.doc, ['C'], vec(0, 0), vec(1, 0), true, newId),
    ];
    for (const op of ops) {
      const r = op(s);
      if (!r.ok) throw new Error(r.message);
      s = run(s, { type: 'commitDocument', doc: r.doc, message: r.message });
      states.push(s.doc);
    }
    for (let i = states.length - 2; i >= 0; i--) {
      s = run(s, { type: 'undo' });
      expect(s.doc).toEqual(states[i]);
    }
    for (let i = 1; i < states.length; i++) {
      s = run(s, { type: 'redo' });
      expect(s.doc).toEqual(states[i]);
    }
  });

  it('a refused operation leaves state and history untouched', () => {
    const s0 = start();
    const r = trimLine(s0.doc, 'W', vec(150, 0), newId); // nothing crosses W
    expect(r.ok).toBe(false);
    expect(s0.past).toHaveLength(1);
  });

  it('select all includes dimensions; selection drops items removed by undo', () => {
    const d = createRadialDimension(start().doc, 'R', 'radius', 'C', vec(80, 60), S);
    if (!d.ok) throw new Error(d.message);
    let s = run(start(), { type: 'commitDocument', doc: addDimensions(start().doc, [d.value]), message: '' }, { type: 'selectAll' });
    expect(s.selection).toContain('R');
    s = run(s, { type: 'undo' });
    expect(s.selection).not.toContain('R');
  });
});
