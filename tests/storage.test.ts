import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { measureDimension } from '../src/model/dimensions';
import { createCircle, createLine, createPolyline, createRect } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, DEFAULT_LAYER, type DrawingDocument } from '../src/model/types';
import {
  DEFAULT_DISPLAY,
  DocumentFormatError,
  FILE_FORMAT_VERSION,
  parseDocument,
  parseProject,
  serializeDocument,
  serializeProject,
} from '../src/storage/documentStorage';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const L2 = { id: 'L2', name: 'Annotation', visible: false, locked: true, color: '#c5221f' };

const doc: DrawingDocument = {
  ...createEmptyDocument(),
  scale: { paper: 1, real: 20 },
  layers: [DEFAULT_LAYER, L2],
  shapes: [
    { ...createLine('l', vec(0, 0), vec(1234.5, 67.25)), layerId: 'layer-0' },
    { ...createRect('r', vec(1, 2), 3, 4, 33.3), layerId: 'L2' },
    { ...createCircle('c', vec(5, 6), 7), layerId: 'layer-0', style: { stroke: 'bylayer', strokeWidthMm: 0.5 } },
    { ...createPolyline('p', [vec(0, 0), vec(1, 1), vec(2, 0)]), layerId: 'layer-0' },
    { ...createLine('l2', vec(0, 0), vec(0, 50)), layerId: 'layer-0' },
  ],
  dimensions: [
    { id: 'd1', kind: 'aligned', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 1.5, offset: -10, p1: { kind: 'shape', shapeId: 'l', key: 'start' }, p2: { kind: 'point', point: vec(9, 9) }, layerId: 'L2' },
    { id: 'd3', kind: 'radius', mode: 'driven', style: { ...DEFAULT_DIMENSION_STYLE, arrowhead: 'tick', decimals: 0 }, textShift: 0, circleId: 'c', angleDeg: 30, layerId: 'layer-0' },
    { id: 'd4', kind: 'angular', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, line1Id: 'l', line2Id: 'l2', sign1: 1, sign2: -1, radius: 20, layerId: 'layer-0' },
  ],
  constraints: [
    { id: 'k1', kind: 'vertical', line: 'l2', suppressed: false },
    { id: 'k2', kind: 'fixed-length', line: 'l2', value: 50, suppressed: true },
    { id: 'k3', kind: 'tangent', a: 'l', b: 'c', internal: false, suppressed: false },
    { id: 'k4', kind: 'coincident', p: { shapeId: 'l', key: 'start' }, q: { shapeId: 'l2', key: 'start' }, suppressed: false },
    { id: 'k5', kind: 'fixed-position', p: { shapeId: 'c', key: 'center' }, x: 5, y: 6, suppressed: false },
  ],
};
const settings = { activeLayerId: 'L2', display: { ...DEFAULT_DISPLAY, showGrid: false, gridSpacingMm: 25, gridSnapStepMm: 0.5, objectSnap: false } };

describe('project file v3: round trip', () => {
  it('preserves geometry, dimensions, constraints, layers, units, orientation, scale and display preferences', () => {
    const text = serializeProject(doc, settings);
    const json = JSON.parse(text);
    expect(json.formatVersion).toBe(FILE_FORMAT_VERSION);
    expect(json.units).toBe('mm');
    expect(json.page).toEqual({ widthMm: 420, heightMm: 297, orientation: 'landscape' });
    const back = parseProject(text);
    expect(back.doc).toEqual(doc);
    expect(back.settings).toEqual(settings);
    expect(back.warnings).toEqual([]);
    expect(back.sourceVersion).toBe(FILE_FORMAT_VERSION);
  });

  it('saving and re-saving is stable (byte-identical)', () => {
    const once = serializeProject(doc, settings);
    const twice = serializeProject(parseProject(once).doc, parseProject(once).settings);
    expect(twice).toBe(once);
  });

  it('objects created without a layer are written onto the first layer', () => {
    const d = { ...createEmptyDocument(), shapes: [createLine('x', vec(0, 0), vec(1, 0))] };
    expect(JSON.parse(serializeDocument(d)).shapes[0].layerId).toBe('layer-0');
  });
});

describe('opening older project files (migration)', () => {
  it('Milestone 1 (v1) file: geometry intact, default layer, no dimensions/constraints, upgrade notice', () => {
    const p = parseProject(fixture('milestone1-v1.a3d'));
    expect(p.sourceVersion).toBe(1);
    expect(p.doc.shapes).toHaveLength(4);
    expect(p.doc.shapes[1]).toMatchObject({ kind: 'rect', origin: vec(220, 115), width: 100, height: 50, style: { stroke: '#c5221f', strokeWidthMm: 0.5 }, layerId: 'layer-0' });
    expect(p.doc.scale).toEqual({ paper: 1, real: 20 });
    expect(p.doc.layers).toEqual([DEFAULT_LAYER]);
    expect(p.doc.dimensions).toEqual([]);
    expect(p.doc.constraints).toEqual([]);
    expect(p.settings.display).toEqual(DEFAULT_DISPLAY);
    expect(p.warnings[0]).toMatch(/Upgraded from format version 1 to 4/);
  });

  it('Milestone 2 (v2) file: dimensions stay linked and measure the same values', () => {
    const p = parseProject(fixture('milestone2-v2.a3d'));
    expect(p.sourceVersion).toBe(2);
    expect(p.doc.dimensions.map((d) => d.layerId)).toEqual(['layer-0', 'layer-0']);
    expect(measureDimension(p.doc, p.doc.dimensions[0])).toBe(120);
    expect(measureDimension(p.doc, p.doc.dimensions[1])).toBe(25);
    expect(p.doc.shapes[1]).toMatchObject({ center: vec(250.25, 120.75) });
  });

  it('a migrated file re-saves as v3 and re-opens identically without warnings', () => {
    const p = parseProject(fixture('milestone2-v2.a3d'));
    const again = parseProject(serializeProject(p.doc, p.settings));
    expect(again.doc).toEqual(p.doc);
    expect(again.warnings).toEqual([]);
  });
});

describe('invalid, incomplete and unsupported files', () => {
  const base = () => JSON.parse(serializeProject(doc, settings));
  const bad = (mutate: (j: Record<string, any>) => void) => {
    const j = base();
    mutate(j);
    return () => parseProject(JSON.stringify(j));
  };

  it('empty, truncated and non-JSON files', () => {
    expect(() => parseProject('')).toThrow(/empty/);
    expect(() => parseProject(serializeProject(doc).slice(0, 200))).toThrow(/not valid JSON.*truncated/);
    expect(() => parseProject('not json')).toThrow(DocumentFormatError);
  });

  it('other formats and newer versions are refused with a clear message', () => {
    expect(() => parseProject('{"format":"other"}')).toThrow(/Not an A3/);
    expect(bad((j) => (j.formatVersion = 99))).toThrow(/newer version.*format 99.*not changed/);
    expect(bad((j) => (j.formatVersion = 'two'))).toThrow(/formatVersion/);
    expect(bad((j) => (j.units = 'inch'))).toThrow(/units/);
  });

  it('errors name the exact path of the problem', () => {
    expect(bad((j) => (j.shapes[2].radius = -1))).toThrow('shapes[2].radius: must be ≥ 0');
    expect(bad((j) => delete j.shapes[0].start)).toThrow('shapes[0].start: must be an object');
    expect(bad((j) => (j.layers[1].color = 'red'))).toThrow('layers[1].color');
    expect(bad((j) => (j.constraints[1].value = 0))).toThrow('constraints[1].value: must be > 0');
    expect(bad((j) => (j.constraints[0].kind = 'magic'))).toThrow('constraints[0].kind: unknown constraint kind "magic"');
    expect(bad((j) => (j.dimensions[0].style.arrowhead = 'huge'))).toThrow('dimensions[0].style.arrowhead');
    expect(bad((j) => (j.page.orientation = 'portrait'))).toThrow('page.orientation');
    expect(bad((j) => (j.scale.real = 0))).toThrow(/scale/);
    expect(bad((j) => (j.settings.display.gridSpacingMm = -5))).toThrow('settings.display.gridSpacingMm');
  });

  it('structural problems: missing layers, duplicate ids / layer names', () => {
    expect(bad((j) => (j.layers = []))).toThrow(/at least one layer/);
    expect(bad((j) => delete j.layers)).toThrow('layers: must be an array');
    expect(bad((j) => (j.layers[1].name = 'default'))).toThrow(/duplicate layer name/);
    expect(bad((j) => (j.shapes[1].id = 'l'))).toThrow(/Duplicate object id "l"/);
    expect(bad((j) => (j.constraints[0].id = 'd1'))).toThrow(/Duplicate object id "d1"/);
  });

  it('repairable problems are repaired AND reported, never silently dropped', () => {
    const p = parseProject(
      JSON.stringify({
        ...base(),
        shapes: base().shapes.map((s: { id: string }) => (s.id === 'p' ? { ...s, layerId: 'ghost' } : s)),
        constraints: [...base().constraints, { id: 'k9', kind: 'horizontal', line: 'gone', suppressed: false }],
        settings: { activeLayerId: 'nope', display: { showGrid: true } },
      }),
    );
    expect(p.doc.shapes.find((s) => s.id === 'p')!.layerId).toBe('layer-0');
    expect(p.doc.constraints).toHaveLength(6); // kept, shown as broken
    expect(p.warnings.join('\n')).toMatch(/unknown layer "ghost"/);
    expect(p.warnings.join('\n')).toMatch(/missing object\(s\) gone/);
    expect(p.warnings.join('\n')).toMatch(/Active layer "nope" not found/);
    expect(p.warnings.join('\n')).toMatch(/gridSpacingMm" missing/);
  });

  it('parseDocument remains available for existing callers', () => {
    expect(parseDocument(serializeProject(doc, settings))).toEqual(doc);
  });
});
