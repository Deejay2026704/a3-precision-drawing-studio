import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { createLine } from '../src/model/shapes';
import { exportPdf, LETTER_LANDSCAPE, paperTiles, TILE_MARGIN_MM, TILE_OVERLAP_MM } from '../src/storage/exportPdf';

const doc = { ...createEmptyDocument(), shapes: [createLine('L', vec(10, 10), vec(410, 287))] };
const pages = (b: Uint8Array) => (new TextDecoder('latin1').decode(b).match(/\/Type \/Page\b(?!s)/g) ?? []).length;
let poppler = true;
try {
  execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
} catch {
  poppler = false;
}

describe('US Letter print layouts', () => {
  it('Letter tiles cover the A3 sheet with the stated overlap', () => {
    const t = paperTiles(420, 297, LETTER_LANDSCAPE);
    expect(t).toHaveLength(4);
    const pw = LETTER_LANDSCAPE.widthMm - 2 * TILE_MARGIN_MM;
    expect(Math.min(...t.map((x) => x.x0))).toBe(0);
    expect(Math.max(...t.map((x) => x.x0 + x.w))).toBeCloseTo(420, 9);
    expect(Math.min(...t.map((x) => x.y0))).toBe(0);
    expect(Math.max(...t.map((x) => x.y0 + x.h))).toBeCloseTo(297, 9);
    const xs = [...new Set(t.map((x) => x.x0))].sort((a, b) => a - b);
    expect(xs[0] + pw - xs[1]).toBeGreaterThanOrEqual(TILE_OVERLAP_MM - 1e-9);
  });
  it('tiled = 4 Letter pages at true scale; fit = 1 page marked NOT TO SCALE', () => {
    const tiled = exportPdf(doc, { layout: 'letter-tiled', date: new Date(0) });
    const fit = exportPdf(doc, { layout: 'letter-fit', date: new Date(0) });
    expect(pages(tiled)).toBe(4);
    expect(pages(fit)).toBe(1);
    const t = new TextDecoder('latin1').decode(tiled);
    expect(t).toContain('/MediaBox [0 0 792 612]'); // 11 × 8.5 in
    expect(t).toContain('1 0 0 1 '); // translation only: no scaling on tiles
    expect(new TextDecoder('latin1').decode(fit)).toMatch(/to fit Letter/);
  });
  it.skipIf(!poppler)('poppler reads the Letter pages', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'a3-letter-'));
    const f = path.join(dir, 't.pdf');
    writeFileSync(f, exportPdf(doc, { layout: 'letter-tiled' }));
    const info = execFileSync('pdfinfo', [f], { encoding: 'utf8' });
    expect(info).toMatch(/Pages:\s+4/);
    expect(info).toMatch(/Page size:\s+792 x 612 pts \(letter\)/);
  });
});
