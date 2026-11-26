import { describe, expect, it } from 'vitest';
import { DocumentFormatError, parseDocument, serializeDocument } from '../src/storage/documentStorage';
import { createEmptyDocument } from '../src/model/document';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument } from '../src/model/types';
import { createCircle, createLine, createPolyline, createRect } from '../src/model/shapes';
import { vec } from '../src/geometry/vec';

describe('document storage', () => {
  const doc = {
    ...createEmptyDocument(),
    scale: { paper: 1, real: 20 },
    shapes: [
      createLine('l', vec(0, 0), vec(1234.5, 67.25)),
      createRect('r', vec(1, 2), 3, 4, 33.3),
      createCircle('c', vec(5, 6), 7),
      createPolyline('p', [vec(0, 0), vec(1, 1), vec(2, 0)]),
    ],
  };

  it('round-trips a document exactly', () => {
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  });

  it('stores millimetre units and the format header', () => {
    const json = JSON.parse(serializeDocument(doc));
    expect(json.format).toBe('a3-precision-drawing');
    expect(json.formatVersion).toBe(2);
    expect(json.units).toBe('mm');
    expect(json.page).toEqual({ widthMm: 420, heightMm: 297 });
  });

  it('still opens Milestone 1 (format version 1) files, with no dimensions', () => {
    const v1 = JSON.parse(serializeDocument(doc));
    v1.formatVersion = 1;
    delete v1.dimensions;
    const loaded = parseDocument(JSON.stringify(v1));
    expect(loaded.shapes).toEqual(doc.shapes);
    expect(loaded.dimensions).toEqual([]);
  });

  it('round-trips linked and fixed dimensions of every kind', () => {
    const style = DEFAULT_DIMENSION_STYLE;
    const withDims = {
      ...doc,
      shapes: [...doc.shapes, createLine('l2', vec(0, 0), vec(0, 50))],
      dimensions: [
        { id: 'd1', kind: 'aligned', mode: 'driven', style, textShift: 1.5, offset: -10, p1: { kind: 'shape', shapeId: 'l', key: 'start' }, p2: { kind: 'point', point: vec(9, 9) } },
        { id: 'd2', kind: 'horizontal', mode: 'driven', style, textShift: 0, offset: 5, p1: { kind: 'shape', shapeId: 'r', key: 'c0' }, p2: { kind: 'shape', shapeId: 'r', key: 'c1' } },
        { id: 'd3', kind: 'radius', mode: 'driven', style: { ...style, arrowhead: 'tick', decimals: 0 }, textShift: 0, circleId: 'c', angleDeg: 30 },
        { id: 'd4', kind: 'angular', mode: 'driven', style, textShift: 0, line1Id: 'l', line2Id: 'l2', sign1: 1, sign2: -1, radius: 20 },
      ],
    } as DrawingDocument;
    expect(parseDocument(serializeDocument(withDims))).toEqual(withDims);
  });

  it('rejects malformed dimensions', () => {
    const base = JSON.parse(serializeDocument(doc));
    const bad = (dim: object) => JSON.stringify({ ...base, dimensions: [dim] });
    expect(() => parseDocument(bad({ id: 'x', kind: 'radius', mode: 'constraint' }))).toThrow(/mode/);
    expect(() => parseDocument(bad({ id: 'x', kind: 'weird', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0 }))).toThrow(/kind/);
    expect(() => parseDocument(bad({ id: 'l', kind: 'radius', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, circleId: 'c', angleDeg: 0 }))).toThrow(/Duplicate/);
  });

  it('rejects malformed files with a clear error', () => {
    expect(() => parseDocument('not json')).toThrow(DocumentFormatError);
    expect(() => parseDocument('{"format":"other"}')).toThrow(/Not an A3/);
    const bad = JSON.parse(serializeDocument(doc));
    bad.shapes[2].radius = -1;
    expect(() => parseDocument(JSON.stringify(bad))).toThrow(/radius/);
    const dup = JSON.parse(serializeDocument(doc));
    dup.shapes[1].id = 'l';
    expect(() => parseDocument(JSON.stringify(dup))).toThrow(/Duplicate/);
    const badScale = JSON.parse(serializeDocument(doc));
    badScale.scale.real = 0;
    expect(() => parseDocument(JSON.stringify(badScale))).toThrow(/scale/);
  });
});
