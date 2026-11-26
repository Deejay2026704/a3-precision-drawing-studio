import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createCircle, createLine, createPolyline, createRect, lineLength, shapeBounds } from '../src/model/shapes';
import { duplicateShape, moveBoundsTo, moveShape } from '../src/model/operations';
import { createEmptyDocument, duplicateShapes, removeShapes, replaceShapes } from '../src/model/document';

describe('object movement', () => {
  it('moves every shape kind by an exact delta', () => {
    expect(moveShape(createLine('l', vec(0, 0), vec(10, 0)), 5, -2)).toMatchObject({ start: vec(5, -2), end: vec(15, -2) });
    expect(moveShape(createRect('r', vec(1, 1), 4, 4, 30), 10, 10)).toMatchObject({ origin: vec(11, 11), width: 4, height: 4, rotationDeg: 30 });
    expect(moveShape(createCircle('c', vec(0, 0), 3), 2.5, 2.5)).toMatchObject({ center: vec(2.5, 2.5), radius: 3 });
    expect(moveShape(createPolyline('p', [vec(0, 0), vec(1, 1)]), 1, 2).points).toEqual([vec(1, 2), vec(2, 3)]);
  });

  it('movement preserves size', () => {
    const l = createLine('l', vec(0, 0), vec(30, 40));
    expect(lineLength(moveShape(l, 123.4, -56.7))).toBeCloseTo(50, 10);
  });

  it('does not mutate the original shape', () => {
    const l = createLine('l', vec(0, 0), vec(10, 0));
    moveShape(l, 5, 5);
    expect(l.start).toEqual(vec(0, 0));
  });

  it('moves a shape so its bounding box starts at an exact position', () => {
    const p = moveBoundsTo(createPolyline('p', [vec(3, 4), vec(10, 20)]), 100, 50);
    expect(shapeBounds(p)).toEqual({ minX: 100, minY: 50, maxX: 107, maxY: 66 });
  });

  it('duplicates shapes with new ids at an offset, leaving the originals', () => {
    const doc = { ...createEmptyDocument(), shapes: [createLine('a', vec(0, 0), vec(10, 0))] };
    let n = 0;
    const res = duplicateShapes(doc, ['a'], () => `copy${++n}`, vec(10, -10));
    expect(res.newIds).toEqual(['copy1']);
    expect(res.doc.shapes).toHaveLength(2);
    expect(res.doc.shapes[0]).toEqual(doc.shapes[0]);
    expect(res.doc.shapes[1]).toMatchObject({ id: 'copy1', start: vec(10, -10), end: vec(20, -10) });
    expect(duplicateShape(createCircle('c', vec(1, 1), 1), 'd', vec(1, 1))).toMatchObject({ id: 'd', center: vec(2, 2) });
  });

  it('replaces and removes shapes by id while keeping painting order', () => {
    const a = createLine('a', vec(0, 0), vec(1, 0));
    const b = createLine('b', vec(0, 0), vec(2, 0));
    const doc = { ...createEmptyDocument(), shapes: [a, b] };
    const moved = replaceShapes(doc, [moveShape(a, 1, 1)]);
    expect(moved.shapes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(moved.shapes[0]).toMatchObject({ start: vec(1, 1) });
    expect(removeShapes(doc, ['a']).shapes).toEqual([b]);
  });
});
