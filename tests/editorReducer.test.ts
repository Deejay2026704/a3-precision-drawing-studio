import { describe, expect, it } from 'vitest';
import { createInitialState, editorReducer, isDirty, type EditorAction, type EditorState } from '../src/ui/state/editorReducer';
import { createLine } from '../src/model/shapes';
import { moveShape } from '../src/model/operations';
import { vec } from '../src/geometry/vec';

const run = (actions: EditorAction[], s: EditorState = createInitialState()) => actions.reduce(editorReducer, s);
const line = createLine('l1', vec(0, 0), vec(100, 0));

describe('editor state (single source of truth + undo)', () => {
  it('adding a shape selects it and marks the document dirty', () => {
    const s = run([{ type: 'addShapes', shapes: [line] }]);
    expect(s.doc.shapes).toEqual([line]);
    expect(s.selection).toEqual(['l1']);
    expect(isDirty(s)).toBe(true);
  });

  it('an interactive drag produces exactly one undo step', () => {
    const s = run([
      { type: 'addShapes', shapes: [line] },
      { type: 'beginEdit' },
      { type: 'previewShapes', shapes: [moveShape(line, 1, 0)] },
      { type: 'previewShapes', shapes: [moveShape(line, 2, 0)] },
      { type: 'previewShapes', shapes: [moveShape(line, 3, 0)] },
      { type: 'endEdit' },
    ]);
    expect(s.doc.shapes[0]).toMatchObject({ start: vec(3, 0) });
    expect(s.past).toHaveLength(2);
    const u = editorReducer(s, { type: 'undo' });
    expect(u.doc.shapes[0]).toEqual(line);
    const r = editorReducer(u, { type: 'redo' });
    expect(r.doc.shapes[0]).toMatchObject({ start: vec(3, 0) });
  });

  it('cancelling a drag restores the geometry', () => {
    const s = run([{ type: 'addShapes', shapes: [line] }, { type: 'beginEdit' }, { type: 'previewShapes', shapes: [moveShape(line, 9, 9)] }, { type: 'cancelEdit' }]);
    expect(s.doc.shapes[0]).toEqual(line);
  });

  it('deleting removes the selection; undo brings it back', () => {
    const s = run([{ type: 'addShapes', shapes: [line] }, { type: 'deleteSelection' }]);
    expect(s.doc.shapes).toHaveLength(0);
    expect(s.selection).toEqual([]);
    expect(editorReducer(s, { type: 'undo' }).doc.shapes).toEqual([line]);
  });

  it('changing scale keeps shapes identical and is undoable', () => {
    const s = run([{ type: 'addShapes', shapes: [line] }, { type: 'setScale', scale: { paper: 1, real: 100 } }]);
    expect(s.doc.shapes[0]).toBe(line);
    expect(s.doc.scale).toEqual({ paper: 1, real: 100 });
    expect(editorReducer(s, { type: 'undo' }).doc.scale).toEqual({ paper: 1, real: 1 });
  });

  it('saving clears the dirty flag', () => {
    const s = run([{ type: 'addShapes', shapes: [line] }, { type: 'markSaved', path: '/x/a.a3d', name: 'a.a3d' }]);
    expect(isDirty(s)).toBe(false);
    expect(s.fileName).toBe('a.a3d');
  });
});
