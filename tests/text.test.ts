import { describe, expect, it } from 'vitest';
import { textWidth } from '../src/geometry/helvetica';
import { distance, vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { distanceToShape } from '../src/model/hitTest';
import { mirrorShape, offsetShape, trimShape } from '../src/model/modify';
import { moveShape, rotateShape, scaleShape } from '../src/model/operations';
import { createLine, shapeBounds } from '../src/model/shapes';
import { LINE_SPACING, lineBaselines, textCenter, textCorners } from '../src/model/text';
import { BY_LAYER, DEFAULT_DIMENSION_STYLE, MAX_TEXT_LENGTH, type DrawingDocument, type Shape, type TextShape } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/documentStorage';
import { drawingPrimitives } from '../src/storage/drawingPrimitives';
import { exportPdf } from '../src/storage/exportPdf';
import { exportSvg } from '../src/storage/exportSvg';
import { newSession, toolClick } from '../src/ui/interaction/toolSession';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
const T: TextShape = { id: 'T', kind: 'text', position: vec(100, 100), text: 'Hello', height: 10, rotationDeg: 0, style: { stroke: BY_LAYER, strokeWidthMm: 0.25 } };
const near = (a: number, b: number, d = 9) => expect(a).toBeCloseTo(b, d);

describe('text layout', () => {
  it('the box is as wide as the Helvetica text and spans ascender to descender', () => {
    const b = shapeBounds(T);
    near(b.maxX - b.minX, textWidth('Hello', 10));
    near(b.maxY, 100 + 7.18);
    near(b.minY, 100 - 2.07);
  });
  it('more lines go downwards by 1.25 × the height; rotation turns the whole block', () => {
    const two = { ...T, text: 'A\nBB' };
    expect(lineBaselines(two).map((l) => l.at)).toEqual([vec(100, 100), vec(100, 100 - LINE_SPACING * 10)]);
    const r = { ...two, rotationDeg: 90 };
    const second = lineBaselines(r)[1].at;
    near(second.x, 100 + LINE_SPACING * 10);
    near(second.y, 100);
  });
  it('is picked anywhere on its box', () => {
    expect(distanceToShape(T, vec(105, 103))).toBe(0);
    near(distanceToShape(T, vec(95, 103)), 5);
  });
});

describe('editing text', () => {
  it('move / rotate / scale keep the text intact', () => {
    expect(moveShape(T, 5, -5).position).toEqual(vec(105, 95));
    const r = rotateShape(T, 30, vec(100, 100));
    expect(r.rotationDeg).toBe(30);
    expect(r.position).toEqual(vec(100, 100));
    const s = scaleShape(T, 2, 2, vec(0, 0));
    expect(s.position).toEqual(vec(200, 200));
    expect(s.height).toBe(20);
  });
  it('mirroring moves the text box but never writes the text backwards', () => {
    const m = mirrorShape(T, vec(0, 0), vec(0, 1)); // about the Y axis
    expect(m.rotationDeg).toBe(0);
    const c0 = textCenter(T);
    const c1 = textCenter(m);
    near(c1.x, -c0.x);
    near(c1.y, c0.y);
    const flipped = mirrorShape(T, vec(0, 0), vec(1, 0)); // about the X axis: still upright
    expect(Math.cos((flipped.rotationDeg * Math.PI) / 180)).toBeGreaterThan(0);
  });
  it('text cannot be offset and is never a cutting edge', () => {
    expect(offsetShape(docOf(T), 'T', 5, vec(0, 0), () => 'x').ok).toBe(false);
    const L = createLine('L', vec(90, 102), vec(200, 102)); // runs through the text
    expect(trimShape(docOf(T, L), 'L', vec(110, 102), () => 'x').ok).toBe(false);
  });
});

describe('text in files and exports', () => {
  it('round trip; too long is refused with the path', () => {
    const doc = docOf({ ...T, text: 'Line 1\nLine 2 – Ø 20', rotationDeg: 15 });
    const back = parseProject(serializeProject(doc)).doc.shapes[0] as TextShape;
    expect(back).toMatchObject(doc.shapes[0]);
    const bad = JSON.parse(serializeProject(doc));
    bad.shapes[0].text = 'x'.repeat(MAX_TEXT_LENGTH + 1);
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/shapes\[0\]\.text/);
    bad.shapes[0].text = 'ok';
    bad.shapes[0].height = 0;
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/shapes\[0\]\.height/);
  });
  it('exports one text item per line at the scaled size (drawing 1:2 → half size on paper)', () => {
    const doc = { ...docOf({ ...T, text: 'Top\nBottom' }), scale: { paper: 1, real: 2 } };
    const prims = drawingPrimitives(doc)[0].items[0].prims;
    expect(prims).toHaveLength(2);
    expect(prims[0]).toMatchObject({ kind: 'text', text: 'Top', height: 5, anchor: 'start', pos: vec(50, 50) });
    expect(prims[1]).toMatchObject({ kind: 'text', text: 'Bottom', pos: vec(50, 50 - LINE_SPACING * 5) });
    expect(exportSvg(doc)).toMatch(/<text[^>]*text-anchor="start"[^>]*>Top<\/text>/);
    expect(new TextDecoder('latin1').decode(exportPdf(doc))).toContain('(Bottom) Tj');
  });
  it('text tool: one click places text at the snapped point with the given size', () => {
    const step = toolClick(newSession('text'), { doc: createEmptyDocument(), selection: [], snap: null, tolerance: 1, dimStyle: DEFAULT_DIMENSION_STYLE, offsetDistanceMm: 5, mirrorKeepSource: true, newId: () => 'N', raw: vec(10.2, 20.1), point: vec(10, 20), textHeight: 7 });
    expect(step.kind).toBe('commit');
    if (step.kind === 'commit') expect(step.doc.shapes[0]).toMatchObject({ kind: 'text', position: vec(10, 20), height: 7, text: 'Text' });
    expect(distance(textCorners(T)[0], vec(100, 100 - 2.07))).toBeLessThan(1e-9);
  });
});

describe('file format 5', () => {
  it('a v4 file opens (upgraded, with a notice); a file from a newer version is refused', () => {
    const v4 = JSON.parse(serializeProject(docOf(createLine('L', vec(0, 0), vec(10, 0)))));
    v4.formatVersion = 4;
    const p = parseProject(JSON.stringify(v4));
    expect(p.doc.shapes).toHaveLength(1);
    expect(p.warnings.join(' ')).toMatch(/format version 4 to 5/);
    expect(() => parseProject(JSON.stringify({ ...v4, formatVersion: 6 }))).toThrow(/newer version/);
  });
});
