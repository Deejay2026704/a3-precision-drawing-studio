import { describe, expect, it } from 'vitest';
import { circlePolygon, hatchLines, pointInPolygon } from '../src/geometry/hatch';
import { distance, vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { fillOutline, hatchSegments, isFillable } from '../src/model/fill';
import { distanceToShape } from '../src/model/hitTest';
import { createCircle, createLine, createPolyline, createRect } from '../src/model/shapes';
import { DEFAULT_FILL, type DrawingDocument, type Shape } from '../src/model/types';
import { drawingPrimitives } from '../src/storage/drawingPrimitives';
import { exportSvg } from '../src/storage/exportSvg';
import { exportPdf } from '../src/storage/exportPdf';
import { parseProject, serializeProject } from '../src/storage/documentStorage';

const docOf = (...shapes: Shape[]): DrawingDocument => ({ ...createEmptyDocument(), shapes });
const withFill = <S extends Shape>(s: S, fill = DEFAULT_FILL): S => ({ ...s, style: { ...s.style, fill } });
const SQ = createRect('R', vec(0, 0), 10, 10, 0);

describe('hatch geometry', () => {
  it('horizontal hatch of a 10 mm square at 1 mm: 10 full-width lines', () => {
    const l = hatchLines(fillOutline(SQ)!, 0, 1)!;
    expect(l).toHaveLength(10);
    for (const [a, b] of l) expect(distance(a, b)).toBeCloseTo(10, 12);
  });
  it('45° lines end exactly on the boundary and stay inside', () => {
    const l = hatchLines(fillOutline(SQ)!, 45, 2)!;
    expect(l.length).toBeGreaterThan(5);
    for (const [a, b] of l) {
      for (const p of [a, b]) expect(Math.min(p.x, p.y, 10 - p.x, 10 - p.y)).toBeCloseTo(0, 9);
      const m = vec((a.x + b.x) / 2, (a.y + b.y) / 2);
      expect(pointInPolygon(m, fillOutline(SQ)!)).toBe(true);
    }
  });
  it('lines are anchored to the drawing origin, so neighbouring areas line up', () => {
    const a = hatchLines(fillOutline(createRect('A', vec(0, 0), 10, 10, 0))!, 0, 3)!;
    const b = hatchLines(fillOutline(createRect('B', vec(10, 0), 10, 10, 0))!, 0, 3)!;
    expect(a.map(([p]) => p.y)).toEqual(b.map(([p]) => p.y));
  });
  it('circles: hatch ends lie on the circle; concave polygons give several pieces per line', () => {
    for (const [a, b] of hatchLines(circlePolygon(vec(5, 5), 20), 30, 2)!) {
      expect(distance(a, vec(5, 5))).toBeCloseTo(20, 2);
      expect(distance(b, vec(5, 5))).toBeCloseTo(20, 2);
    }
    const U = [vec(0, 0), vec(30, 0), vec(30, 20), vec(20, 20), vec(20, 10), vec(10, 10), vec(10, 20), vec(0, 20)];
    const at15 = hatchLines(U, 0, 15)!.filter(([p]) => Math.abs(p.y - 15) < 1e-9);
    expect(at15).toHaveLength(2); // the two prongs of the U
  });
  it('spacing is paper mm: 3 mm at 1:2 is 6 mm on the drawing; too dense → null', () => {
    const big = createRect('B', vec(0, 0), 60, 60, 0);
    const f = { ...DEFAULT_FILL, angleDeg: 0, spacingMm: 3 };
    expect(hatchSegments(big, f, { paper: 1, real: 2 })).toHaveLength(10);
    expect(hatchSegments(big, { ...f, pattern: 'crosshatch' }, { paper: 1, real: 2 })).toHaveLength(20);
    expect(hatchSegments(createRect('H', vec(0, 0), 100000, 100000, 0), f, { paper: 1, real: 1 })).toBeNull();
  });
});

describe('fill on shapes', () => {
  it('only closed shapes can be filled', () => {
    expect(isFillable(SQ)).toBe(true);
    expect(isFillable(createCircle('C', vec(0, 0), 5))).toBe(true);
    expect(isFillable(createPolyline('P', [vec(0, 0), vec(5, 0), vec(5, 5)], undefined, true))).toBe(true);
    expect(isFillable(createPolyline('O', [vec(0, 0), vec(5, 0), vec(5, 5)]))).toBe(false);
    expect(isFillable(createLine('L', vec(0, 0), vec(1, 1)))).toBe(false);
  });
  it('a filled shape is picked anywhere inside it; an unfilled one only at its outline', () => {
    expect(distanceToShape(SQ, vec(5, 5))).toBe(5);
    expect(distanceToShape(withFill(SQ), vec(5, 5))).toBe(0);
  });
  it('exports: solid fill is a filled polygon/disc under the outline; hatch lines are thin lines', () => {
    const solidR = withFill(SQ, { ...DEFAULT_FILL, pattern: 'solid', color: '#c5221f' });
    const solidC = withFill(createCircle('C', vec(50, 50), 10), { ...DEFAULT_FILL, pattern: 'solid', color: '#1a73e8' });
    const hatched = withFill(createRect('H', vec(100, 0), 30, 30, 0), { ...DEFAULT_FILL, angleDeg: 0, spacingMm: 5 });
    const doc = docOf(solidR, solidC, hatched);
    const items = drawingPrimitives(doc)[0].items;
    expect(items[0].prims.map((p) => p.kind)).toEqual(['fill', 'polyline']);
    expect(items[1].prims.map((p) => p.kind)).toEqual(['disc', 'circle']);
    expect(items[2].prims.filter((p) => p.kind === 'line')).toHaveLength(6);
    const svg = exportSvg(doc);
    expect(svg).toContain('<polygon fill="#c5221f"');
    expect(svg).toContain('<circle fill="#1a73e8"');
    const pdf = new TextDecoder('latin1').decode(exportPdf(doc));
    expect(pdf).toMatch(/0\.7725 0\.1333 0\.1216 rg/); // the red fill colour
  });
  it('fill is saved and validated with exact paths', () => {
    const doc = docOf(withFill(SQ, { ...DEFAULT_FILL, pattern: 'crosshatch', angleDeg: 30, spacingMm: 2.5 }));
    const back = parseProject(serializeProject(doc)).doc;
    expect(back.shapes[0].style.fill).toEqual({ pattern: 'crosshatch', color: 'bylayer', angleDeg: 30, spacingMm: 2.5 });
    const bad = JSON.parse(serializeProject(doc));
    bad.shapes[0].style.fill.pattern = 'dots';
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/shapes\[0\]\.style\.fill\.pattern/);
    bad.shapes[0].style.fill = { ...DEFAULT_FILL, spacingMm: 0 };
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/spacingMm/);
  });
});
