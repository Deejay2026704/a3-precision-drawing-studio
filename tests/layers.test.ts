import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import {
  addLayer,
  assignToLayer,
  deleteLayer,
  editableShapes,
  isEditable,
  itemsOnLayer,
  lockedViolation,
  moveLayer,
  renameLayer,
  resolveStroke,
  setLayerProps,
  visibleDimensions,
  visibleShapes,
  type LayerResult,
} from '../src/model/layers';
import { createCircle, createLine } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument } from '../src/model/types';

const ok = (r: LayerResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.doc;
};

function sample(): DrawingDocument {
  let d = createEmptyDocument();
  d = ok(addLayer(d, 'B', 'Walls', '#c5221f'));
  d = ok(addLayer(d, 'C', 'Notes', '#1a73e8'));
  return {
    ...d,
    shapes: [
      { ...createLine('a', vec(0, 0), vec(10, 0)), layerId: 'B', style: { stroke: 'bylayer', strokeWidthMm: 0.35 } },
      { ...createLine('b', vec(0, 5), vec(10, 5)), layerId: 'layer-0' },
      { ...createCircle('c', vec(5, 5), 2), layerId: 'C' },
      createLine('legacy', vec(0, 9), vec(1, 9)), // no layerId → default layer
    ],
    dimensions: [{ id: 'd', kind: 'radius', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, circleId: 'c', angleDeg: 0, layerId: 'C' }],
    constraints: [{ id: 'k', kind: 'horizontal', line: 'a', suppressed: false }],
  };
}

describe('layer operations', () => {
  it('create: unique, non-empty names', () => {
    const d = sample();
    expect(d.layers.map((l) => l.name)).toEqual(['Default', 'Walls', 'Notes']);
    expect(addLayer(d, 'X', 'walls').ok).toBe(false);
    expect(addLayer(d, 'X', '   ').ok).toBe(false);
  });

  it('rename', () => {
    const d = ok(renameLayer(sample(), 'B', '  Outer   walls '));
    expect(d.layers[1].name).toBe('Outer walls');
    expect(renameLayer(d, 'B', 'Notes').ok).toBe(false);
    expect(renameLayer(d, 'B', '').ok).toBe(false);
  });

  it('reorder changes drawing order, refuses past the ends', () => {
    const d = ok(moveLayer(sample(), 'layer-0', 'up'));
    expect(d.layers.map((l) => l.id)).toEqual(['B', 'layer-0', 'C']);
    expect(moveLayer(d, 'C', 'up').ok).toBe(false);
    expect(visibleShapes(d).map((s) => s.id)).toEqual(['a', 'b', 'legacy', 'c']);
  });

  it('assign objects (incl. dimensions) to another layer', () => {
    const d = ok(assignToLayer(sample(), ['b', 'd'], 'B'));
    expect(itemsOnLayer(d, 'B').shapes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(itemsOnLayer(d, 'B').dimensions.map((x) => x.id)).toEqual(['d']);
  });

  it('layer colour is used by "By layer" objects only', () => {
    const d = sample();
    expect(resolveStroke(d, d.shapes[0])).toBe('#c5221f');
    expect(resolveStroke(d, d.shapes[1])).toBe('#000000');
    expect(setLayerProps(d, 'B', { color: 'blue' }).ok).toBe(false);
    expect(resolveStroke(ok(setLayerProps(d, 'B', { color: '#00ff00' })), d.shapes[0])).toBe('#00ff00');
  });
});

describe('visibility and locking', () => {
  it('hidden layers: objects and dimensions are not visible and not editable', () => {
    const d = ok(setLayerProps(sample(), 'C', { visible: false }));
    expect(visibleShapes(d).map((s) => s.id)).not.toContain('c');
    expect(visibleDimensions(d)).toHaveLength(0);
    expect(isEditable(d, d.shapes[2])).toBe(false);
  });

  it('locked layers: visible but not editable', () => {
    const d = ok(setLayerProps(sample(), 'B', { locked: true }));
    expect(visibleShapes(d).map((s) => s.id)).toContain('a');
    expect(editableShapes(d).map((s) => s.id)).not.toContain('a');
  });

  it('objects without a layer belong to the default layer', () => {
    const d = ok(setLayerProps(sample(), 'layer-0', { visible: false }));
    expect(visibleShapes(d).map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('lockedViolation blocks changing, deleting or re-layering locked objects', () => {
    const d = ok(setLayerProps(sample(), 'B', { locked: true }));
    const moved = { ...d, shapes: d.shapes.map((s) => (s.id === 'a' ? { ...s, start: vec(1, 1) } : s)) };
    expect(lockedViolation(d, moved)).toMatch(/cannot be changed/);
    expect(lockedViolation(d, { ...d, shapes: d.shapes.filter((s) => s.id !== 'a') })).toMatch(/Cannot delete/);
    expect(lockedViolation(d, { ...d, shapes: d.shapes.map((s) => (s.id === 'a' ? { ...s, layerId: 'C' } : s)) })).toBeTruthy();
    // unlocked objects may change; unlocking the layer itself is allowed
    expect(lockedViolation(d, { ...d, shapes: d.shapes.map((s) => (s.id === 'b' ? { ...s, end: vec(3, 3) } : s)) })).toBeNull();
    expect(lockedViolation(d, ok(setLayerProps(d, 'B', { locked: false })))).toBeNull();
  });

  it('cannot assign to or from a locked layer', () => {
    const d = ok(setLayerProps(sample(), 'B', { locked: true }));
    expect(assignToLayer(d, ['b'], 'B').ok).toBe(false);
    expect(assignToLayer(d, ['a'], 'C').ok).toBe(false);
  });
});

describe('deleting layers safely', () => {
  it('an empty layer is deleted; the last layer never is', () => {
    let d = ok(addLayer(createEmptyDocument(), 'E', 'Empty'));
    d = ok(deleteLayer(d, 'E', { kind: 'only-if-empty' }));
    expect(d.layers).toHaveLength(1);
    expect(deleteLayer(d, 'layer-0', { kind: 'delete-objects' }).ok).toBe(false);
  });

  it('a layer with objects is refused unless an explicit choice is made', () => {
    const r = deleteLayer(sample(), 'C', { kind: 'only-if-empty' });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/contains 2 objects/) });
  });

  it('reassign moves every object to the chosen layer, losing nothing', () => {
    const d0 = sample();
    const d = ok(deleteLayer(d0, 'C', { kind: 'reassign', to: 'B' }));
    expect(d.layers.map((l) => l.id)).toEqual(['layer-0', 'B']);
    expect(d.shapes).toHaveLength(d0.shapes.length);
    expect(d.dimensions).toHaveLength(1);
    expect(d.shapes.find((s) => s.id === 'c')!.layerId).toBe('B');
    expect(deleteLayer(d0, 'C', { kind: 'reassign', to: 'C' }).ok).toBe(false);
    expect(deleteLayer(ok(setLayerProps(d0, 'B', { locked: true })), 'C', { kind: 'reassign', to: 'B' }).ok).toBe(false);
  });

  it('delete-objects removes the objects and anything that depended on them', () => {
    const d = ok(deleteLayer(sample(), 'B', { kind: 'delete-objects' }));
    expect(d.shapes.map((s) => s.id)).toEqual(['b', 'c', 'legacy']);
    expect(d.constraints).toHaveLength(0); // the horizontal constraint on 'a'
    expect(d.dimensions).toHaveLength(1);
  });
});
