import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { addLayer, setLayerProps, type LayerResult } from '../src/model/layers';
import { createCircle, createLine, createRect } from '../src/model/shapes';
import { DEFAULT_DIMENSION_STYLE, type DrawingDocument } from '../src/model/types';
import { exportPdf, PT_PER_MM, textWidthPt, toWinAnsi } from '../src/storage/exportPdf';

const ok = (r: LayerResult) => {
  if (!r.ok) throw new Error(r.message);
  return r.doc;
};
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const DATE = new Date(Date.UTC(2026, 10, 26, 12, 0, 0));

function doc(): DrawingDocument {
  let d = ok(addLayer(createEmptyDocument(), 'H', 'Hidden stuff', '#ff0000'));
  d = ok(addLayer(d, 'N', 'Ünïcode layer', '#00aa00'));
  return {
    ...d,
    scale: { paper: 1, real: 2 },
    shapes: [
      { ...createLine('L', vec(0, 0), vec(100, 0)), layerId: 'layer-0' },
      { ...createLine('HL', vec(10, 77.77), vec(20, 77.77)), layerId: 'H', style: { stroke: '#123456', strokeWidthMm: 0.7 } },
      { ...createCircle('C', vec(200, 200), 50), layerId: 'N', style: { stroke: 'bylayer', strokeWidthMm: 0.5 } },
      { ...createRect('R', vec(300, 20), 100, 40), layerId: 'layer-0' },
    ],
    dimensions: [
      { id: 'D', kind: 'diameter', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, circleId: 'C', angleDeg: 30, layerId: 'N' },
      { id: 'HD', kind: 'aligned', mode: 'driven', style: DEFAULT_DIMENSION_STYLE, textShift: 0, offset: 5, layerId: 'H', p1: { kind: 'shape', shapeId: 'HL', key: 'start' }, p2: { kind: 'shape', shapeId: 'HL', key: 'end' } },
    ],
  };
}

describe('PDF export', () => {
  const pdf = text(exportPdf(ok(setLayerProps(doc(), 'H', { visible: false })), { title: 'Test', date: DATE }));

  it('is a single A3 landscape page at true size (1190.551 × 841.89 pt)', () => {
    expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 1190.5512 841.8898]');
    expect(420 * PT_PER_MM).toBeCloseTo(1190.5512, 4);
    expect(pdf).toContain('/Count 1');
  });

  it('has a valid cross-reference table (every offset points at its object)', () => {
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const rows = pdf.slice(startxref).split('\n').slice(3).filter((r) => / 00000 n $/.test(r));
    expect(rows.length).toBeGreaterThan(6);
    rows.forEach((r, i) => expect(pdf.slice(Number(r.slice(0, 10)), Number(r.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    const len = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)![1]);
    const start = pdf.indexOf('stream\n') + 7;
    expect(pdf.slice(start + len, start + len + 10)).toBe('\nendstream');
  });

  it('draws at true scale: world (100, 0) at 1:2 → 50 mm = 141.7323 pt', () => {
    expect(pdf).toContain('0 0 m 141.7323 0 l S');
    expect(pdf).toContain(`${(0.35 * PT_PER_MM).toFixed(4)} w`);
  });

  it('excludes hidden layers (objects, dimensions and the layer itself)', () => {
    expect(pdf).not.toContain('Hidden stuff');
    expect(pdf).not.toContain(`${((77.77 / 2) * PT_PER_MM).toFixed(4)}`); // y of the hidden line
    expect(pdf).not.toContain('0.0706 0.2039 0.3373 RG'); // #123456
    expect(pdf).not.toContain('(10.00)'); // hidden dimension text
  });

  it('visible layers become PDF layers; Unicode names are encoded safely', () => {
    expect((pdf.match(/\/Type \/OCG/g) ?? []).length).toBe(2);
    expect(pdf).toContain('/Name (Default)');
    expect(pdf).toContain('/Name <FEFF00DC006E00EF0063006F006400650020006C0061007900650072>');
  });

  it('dimension text uses Helvetica; ⌀ is written as Ø', () => {
    expect(pdf).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(pdf).toContain('(\\330100.00) Tj');
    expect(toWinAnsi('45°')).toEqual([52, 53, 0xb0]);
    expect(textWidthPt(toWinAnsi('10'), 10)).toBeCloseTo(11.12, 6);
  });

  it('"By layer" colour resolves to the layer colour', () => {
    expect(pdf).toContain('0 0.6667 0 RG');
  });

  it('circles are accurate Béziers (max radial error < 1e-4 mm)', () => {
    // circle C: centre (200,200)/2 = (100,100) mm, r = 25 mm on paper
    const block = pdf.slice(pdf.indexOf(`${(125 * PT_PER_MM).toFixed(4)} ${(100 * PT_PER_MM).toFixed(4)} m`));
    const curves = block.split('\n').slice(1, 17).map((l) => l.split(' ').slice(0, 6).map(Number));
    let prev = [125 * PT_PER_MM, 100 * PT_PER_MM];
    let maxErr = 0;
    for (const [x1, y1, x2, y2, x3, y3] of curves) {
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t;
        const x = u * u * u * prev[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const y = u * u * u * prev[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        maxErr = Math.max(maxErr, Math.abs(Math.hypot(x / PT_PER_MM - 100, y / PT_PER_MM - 100) - 25));
      }
      prev = [x3, y3];
    }
    expect(curves).toHaveLength(16);
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('is deterministic for a given date', () => {
    const d = doc();
    expect(text(exportPdf(d, { date: DATE }))).toBe(text(exportPdf(d, { date: DATE })));
  });

  const poppler = (() => {
    try {
      execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!poppler)('an independent PDF reader (poppler) accepts it: A3 page size and readable text', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'a3pdf-'));
    const f = path.join(dir, 'x.pdf');
    writeFileSync(f, exportPdf(doc(), { title: 'Poppler check', date: DATE }));
    const info = execFileSync('pdfinfo', [f], { encoding: 'utf8' });
    expect(info).toMatch(/Page size:\s+1190\.55 x 841\.89 pts/);
    expect(info).toMatch(/Title:\s+Poppler check/);
    expect(info).toMatch(/Pages:\s+1/);
    const txt = execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' });
    expect(txt).toContain('Ø100.00');
  });
});
