import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { addConstraint } from '../src/model/constraints';
import { addLayer, setLayerProps, type LayerResult } from '../src/model/layers';
import { moveShape, setLineLength } from '../src/model/operations';
import { createLine, lineLength } from '../src/model/shapes';
import type { DrawingDocument, LineShape } from '../src/model/types';
import { DEFAULT_DISPLAY, parseProject, serializeProject } from '../src/storage/documentStorage';
import { createInitialState, editorReducer, isDirty, projectSettingsOf, type EditorAction, type EditorState } from '../src/ui/state/editorReducer';

const run = (s: EditorState, ...a: EditorAction[]) => a.reduce(editorReducer, s);
const lay = (r: LayerResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.doc;
};
const line = (s: EditorState, id: string) => s.doc.shapes.find((x) => x.id === id) as LineShape;

/** Two layers; 'a' on Default, 'b' on the locked layer "Fixed". */
function setup(): EditorState {
  let s = run(createInitialState(), { type: 'addShapes', shapes: [createLine('a', vec(0, 0), vec(10, 0))] });
  let d = lay(addLayer(s.doc, 'F', 'Fixed'));
  d = { ...d, shapes: [...d.shapes, { ...createLine('b', vec(0, 5), vec(10, 5)), layerId: 'F' }] };
  d = lay(setLayerProps(d, 'F', { locked: true }));
  s = run(s, { type: 'commitDocument', doc: d, message: 'setup' });
  return s;
}

describe('locked layers in the editor store', () => {
  it('locked objects cannot be selected (click, select all, set selection)', () => {
    const s = setup();
    expect(run(s, { type: 'setSelection', ids: ['a', 'b'] }).selection).toEqual(['a']);
    expect(run(s, { type: 'selectAll' }).selection).toEqual(['a']);
    expect(run(s, { type: 'toggleSelection', id: 'b' }).selection).not.toContain('b');
  });

  it('locked objects cannot be changed, deleted or moved – by any action', () => {
    const s = setup();
    const b = line(s, 'b');
    const t1 = run(s, { type: 'updateShapes', shapes: [moveShape(b, 5, 5)] });
    expect(line(t1, 'b')).toEqual(b);
    expect(t1.message).toMatch(/locked layer/);
    const t2 = run(s, { type: 'commitDocument', doc: { ...s.doc, shapes: s.doc.shapes.filter((x) => x.id !== 'b') }, message: 'x' });
    expect(line(t2, 'b')).toEqual(b);
    // an interactive drag that tries to touch it is discarded
    const t3 = run(s, { type: 'beginEdit' }, { type: 'previewShapes', shapes: [moveShape(b, 1, 0)] }, { type: 'endEdit' });
    expect(line(t3, 'b')).toEqual(b);
    expect(t3.past).toHaveLength(s.past.length);
  });

  it('unlocking makes them editable again', () => {
    let s = setup();
    s = run(s, { type: 'commitDocument', doc: lay(setLayerProps(s.doc, 'F', { locked: false })), message: 'unlock' });
    s = run(s, { type: 'updateShapes', shapes: [moveShape(line(s, 'b'), 5, 0)] });
    expect(line(s, 'b').start.x).toBe(5);
  });

  it('locking/hiding a layer drops its objects from the selection', () => {
    let s = setup();
    s = run(s, { type: 'commitDocument', doc: lay(setLayerProps(s.doc, 'F', { locked: false })), message: '' }, { type: 'selectAll' });
    expect(s.selection).toEqual(['a', 'b']);
    s = run(s, { type: 'commitDocument', doc: lay(setLayerProps(s.doc, 'layer-0', { visible: false })), message: '' });
    expect(s.selection).toEqual(['b']);
  });
});

describe('active layer', () => {
  it('new objects go on the active layer', () => {
    let s = setup();
    s = run(s, { type: 'commitDocument', doc: lay(addLayer(s.doc, 'N', 'Notes')), message: '' }, { type: 'setActiveLayer', id: 'N' });
    s = run(s, { type: 'addShapes', shapes: [createLine('n', vec(0, 0), vec(1, 1))] });
    expect(s.doc.shapes.find((x) => x.id === 'n')!.layerId).toBe('N');
  });

  it('drawing on a locked or hidden active layer is refused', () => {
    let s = run(setup(), { type: 'setActiveLayer', id: 'F' });
    const before = s.doc;
    s = run(s, { type: 'addShapes', shapes: [createLine('n', vec(0, 0), vec(1, 1))] });
    expect(s.doc).toBe(before);
    expect(s.message).toMatch(/locked/);
    s = run(s, { type: 'commitDocument', doc: lay(setLayerProps(s.doc, 'layer-0', { visible: false })), message: '' }, { type: 'setActiveLayer', id: 'layer-0' });
    const b2 = s.doc;
    s = run(s, { type: 'addShapes', shapes: [createLine('n', vec(0, 0), vec(1, 1))] });
    expect(s.doc).toBe(b2);
    expect(s.message).toMatch(/hidden/);
  });
});

describe('constraints in the editor store', () => {
  function constrained(): EditorState {
    let s = run(createInitialState(), { type: 'addShapes', shapes: [createLine('a', vec(0, 0), vec(100, 0)), createLine('c', vec(0, 20), vec(50, 25))] });
    const r1 = addConstraint(s.doc, { id: 'k1', kind: 'fixed-length', line: 'a', value: 100, suppressed: false });
    if (!r1.ok) throw new Error(r1.message);
    const r2 = addConstraint(r1.doc, { id: 'k2', kind: 'parallel', a: 'a', b: 'c', suppressed: false });
    if (!r2.ok) throw new Error(r2.message);
    s = run(s, { type: 'commitDocument', doc: r2.doc, message: 'constraints' });
    return s;
  }

  it('an edit that breaks a driving constraint is re-solved (the constraint wins) and the user is told', () => {
    const s = constrained();
    const s2 = run(s, { type: 'updateShapes', shapes: [setLineLength(line(s, 'a'), 120)], message: 'Line: length' });
    expect(lineLength(line(s2, 'a'))).toBeCloseTo(100, 6);
    expect(s2.message).toMatch(/constraints applied/);
  });

  it('rotating one line keeps the other parallel (the edited line stays put)', () => {
    const s = constrained();
    const a = line(s, 'a');
    const rotated = { ...a, end: vec(a.start.x + 100 * Math.cos(0.5), a.start.y + 100 * Math.sin(0.5)) };
    const s2 = run(s, { type: 'updateShapes', shapes: [rotated] });
    const c = line(s2, 'c');
    const ang = (l: LineShape) => Math.atan2(l.end.y - l.start.y, l.end.x - l.start.x);
    expect(Math.abs(Math.sin(ang(line(s2, 'a')) - ang(c)))).toBeLessThan(1e-6);
    expect(Math.abs(ang(line(s2, 'a')) - 0.5)).toBeLessThan(1e-3);
  });

  it('constraints are applied during an interactive drag, as one undo step', () => {
    const s = constrained();
    const c = line(s, 'c');
    const t = run(s, { type: 'beginEdit' }, { type: 'previewShapes', shapes: [{ ...c, end: vec(c.end.x, c.end.y + 30) }] });
    const ang = (l: LineShape) => Math.atan2(l.end.y - l.start.y, l.end.x - l.start.x);
    expect(Math.abs(Math.sin(ang(line(t, 'a')) - ang(line(t, 'c'))))).toBeLessThan(1e-6);
    const done = run(t, { type: 'endEdit' });
    expect(done.past).toHaveLength(s.past.length + 1);
    expect(run(done, { type: 'undo' }).doc).toBe(s.doc);
  });

  it('deleting a constrained line removes its constraints, reported in the message', () => {
    const s = run(constrained(), { type: 'setSelection', ids: ['c'] }, { type: 'deleteSelection' });
    expect(s.doc.constraints.map((c) => c.id)).toEqual(['k1']);
    expect(s.message).toMatch(/1 dependent constraint/);
  });
});

describe('project settings and the unsaved-changes flag', () => {
  it('display preferences and active layer are saved and restored', () => {
    let s = setup();
    s = run(s, { type: 'setView', view: { showGrid: false, gridSpacingMm: 50, snapStepMm: 5, objectSnap: false } }, { type: 'setActiveLayer', id: 'layer-0' });
    const text = serializeProject(s.doc, projectSettingsOf(s));
    const loaded = parseProject(text);
    const fresh = run(createInitialState(), { type: 'loadDocument', doc: loaded.doc, path: 'x.a3d', name: 'x.a3d', settings: loaded.settings, sourceVersion: loaded.sourceVersion });
    expect(fresh.view).toMatchObject({ showGrid: false, gridSpacingMm: 50, snapStepMm: 5, objectSnap: false });
    expect(fresh.activeLayerId).toBe('layer-0');
    expect(fresh.doc).toEqual(s.doc);
    expect(isDirty(fresh)).toBe(false);
    expect(loaded.settings.display.osnap).toEqual(DEFAULT_DISPLAY.osnap);
  });

  it('any document change marks the project modified; saving clears it; undo back to saved state is clean', () => {
    let s = setup();
    s = run(s, { type: 'markSaved', path: 'p.a3d', name: 'p.a3d' });
    expect(isDirty(s)).toBe(false);
    s = run(s, { type: 'commitDocument', doc: lay(addLayer(s.doc, 'Z', 'Z')), message: '' });
    expect(isDirty(s)).toBe(true);
    s = run(s, { type: 'undo' });
    expect(isDirty(s)).toBe(false);
  });

  it('a migrated file remembers its source version until saved', () => {
    const d: DrawingDocument = parseProject(serializeProject(setup().doc)).doc;
    let s = run(createInitialState(), { type: 'loadDocument', doc: d, path: 'old.a3d', name: 'old.a3d', sourceVersion: 1 });
    expect(s.sourceVersion).toBe(1);
    s = run(s, { type: 'markSaved', path: 'old.a3d', name: 'old.a3d' });
    expect(s.sourceVersion).toBeNull();
  });
});
