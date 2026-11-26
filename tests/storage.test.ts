import { describe, expect, it } from 'vitest';
import { DocumentFormatError, parseDocument, serializeDocument } from '../src/storage/documentStorage';
import { createEmptyDocument } from '../src/model/document';
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
    expect(json.formatVersion).toBe(1);
    expect(json.units).toBe('mm');
    expect(json.page).toEqual({ widthMm: 420, heightMm: 297 });
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
