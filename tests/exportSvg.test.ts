import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { addLayer, setLayerProps, type LayerResult } from '../src/model/layers';
import { createCircle, createLine } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument } from '../src/model/types';
import { exportSvg } from '../src/storage/exportSvg';

const ok = (r: LayerResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.doc;
};

function doc(): DrawingDocument {
  let d = ok(addLayer(createEmptyDocument(), 'H', 'Hidden stuff', '#ff0000'));
  d = ok(addLayer(d, 'K', 'Locked stuff', '#00aa00'));
  return {
    ...d,
    scale: { paper: 1, real: 2 },
    shapes: [
      { ...createLine('visible-line', vec(0, 0), vec(100, 0)), layerId: 'layer-0' },
      { ...createLine('hidden-line', vec(0, 10), vec(100, 10)), layerId: 'H' },
      { ...createCircle('locked-circle', vec(50, 50), 20), layerId: 'K', style: { stroke: 'bylayer', strokeWidthMm: 0.5 } },
    ],
    dimensions: [
      { id: 'hidden-dim', kind: 'aligned', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, offset: 10, layerId: 'H', p1: { kind: 'shape', shapeId: 'visible-line', key: 'start' }, p2: { kind: 'shape', shapeId: 'visible-line', key: 'end' } },
      { id: 'visible-dim', kind: 'radius', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, circleId: 'locked-circle', angleDeg: 0, layerId: 'layer-0' },
    ],
    constraints: [{ id: 'k', kind: 'horizontal', line: 'visible-line', suppressed: false }],
  };
}

describe('SVG export', () => {
  it('excludes objects and dimensions on hidden layers', () => {
    const d = ok(setLayerProps(doc(), 'H', { visible: false }));
    const svg = exportSvg(d);
    expect(svg).not.toContain('hidden-line');
    expect(svg).not.toContain('hidden-dim');
    expect(svg).not.toContain('Hidden stuff');
    expect(svg).toContain('visible-line');
    expect(svg).toContain('visible-dim');
  });

  it('includes locked (but visible) layers, using the layer colour for "By layer" objects', () => {
    const svg = exportSvg(ok(setLayerProps(doc(), 'K', { locked: true })));
    expect(svg).toMatch(/<circle fill="none" stroke="#00aa00" stroke-width="0.5"[^>]*data-id="locked-circle"/);
  });

  it('is sized to the A3 sheet in mm with paper coordinates at the drawing scale (Y flipped)', () => {
    const svg = exportSvg(doc());
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"');
    // world (100, 0) at 1:2 → paper (50, 0) → SVG y = 297
    expect(svg).toMatch(/data-id="visible-line" x1="0" y1="297" x2="50" y2="297"/);
    expect(svg).toMatch(/r="10"/); // radius 20 at 1:2
  });

  it('exports dimension text values and never constraint markers', () => {
    const svg = exportSvg(doc());
    expect(svg).toContain('>R20.00</text>');
    expect(svg).toContain('>100.00</text>');
    expect(svg).not.toMatch(/horizontal|constraint/i);
  });

  it('hiding every layer exports an empty sheet', () => {
    let d = doc();
    for (const l of d.layers) d = ok(setLayerProps(d, l.id, { visible: false }));
    expect(exportSvg(d)).not.toContain('data-id');
  });
});
