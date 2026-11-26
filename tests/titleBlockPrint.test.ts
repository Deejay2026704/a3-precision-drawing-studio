import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { createLine } from '../src/model/shapes';
import { BLOCK_H, BLOCK_W, fitText, titleBlockLayout } from '../src/model/titleBlock';
import { DEFAULT_TITLE_BLOCK, type DrawingDocument } from '../src/model/types';
import { parseProject, serializeProject } from '../src/storage/documentStorage';
import { a4Tiles, exportPdf, PT_PER_MM, TILE_MARGIN_MM, TILE_OVERLAP_MM } from '../src/storage/exportPdf';
import { exportSvg } from '../src/storage/exportSvg';

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const tb = { ...DEFAULT_TITLE_BLOCK, visible: true, title: 'Ground floor plan', drawingNumber: 'A-101', revision: 'C', drawnBy: 'DG', checkedBy: 'KL', date: '2026-11-26', company: 'Studio' };
const doc = (): DrawingDocument => ({
  ...createEmptyDocument(),
  scale: { paper: 1, real: 50 },
  titleBlock: tb,
  shapes: [{ ...createLine('L', vec(0, 0), vec(20000, 0)), layerId: 'layer-0' }],
});

describe('title block', () => {
  it('lays out a frame and a 180 × 40 mm block in the bottom-right, scale filled in automatically', () => {
    const l = titleBlockLayout(doc())!;
    expect(l.lines.slice(0, 4).map(([a]) => a)).toEqual([vec(10, 10), vec(410, 10), vec(410, 287), vec(10, 287)]);
    const values = l.texts.filter((t) => t.kind !== 'label').map((t) => t.text);
    expect(values).toEqual(expect.arrayContaining(['Ground floor plan', 'A-101', 'C', '1:50', 'DG', 'KL', '2026-11-26', 'Studio']));
    const xs = l.lines.flat().map((p) => p.x).filter((x) => x > 200);
    expect(Math.min(...xs)).toBe(410 - BLOCK_W);
    expect(Math.max(...l.lines.flat().filter((p) => p.x >= 230).map((p) => p.y).filter((y) => y < 100))).toBe(10 + BLOCK_H);
  });

  it('is hidden by default and when switched off', () => {
    expect(titleBlockLayout(createEmptyDocument())).toBeNull();
  });

  it('long values are shortened to fit their cell', () => {
    expect(fitText('x'.repeat(200), 30, 3.5)).toHaveLength(14);
    expect(fitText('short', 30, 3.5)).toBe('short');
  });

  it('is saved with the project; text is validated; older files get a hidden one', () => {
    expect(parseProject(serializeProject(doc())).doc.titleBlock).toEqual(tb);
    const bad = JSON.parse(serializeProject(doc()));
    bad.titleBlock.title = 'x'.repeat(500);
    expect(() => parseProject(JSON.stringify(bad))).toThrow('titleBlock.title');
    const v3 = JSON.parse(serializeProject(doc()));
    v3.formatVersion = 3;
    delete v3.titleBlock;
    expect(parseProject(JSON.stringify(v3)).doc.titleBlock).toEqual(DEFAULT_TITLE_BLOCK);
  });

  it('appears in SVG and PDF exports, independent of the drawing scale', () => {
    expect(exportSvg(doc())).toContain('>Ground floor plan</text>');
    const pdf = text(exportPdf(doc()));
    expect(pdf).toContain('(Ground floor plan) Tj');
    expect(pdf).toContain('/Name (Title block)');
  });
});

describe('print layouts', () => {
  it('A4 tiles cover the whole A3 sheet with at least the stated overlap', () => {
    const tiles = a4Tiles(420, 297);
    expect(tiles).toHaveLength(4);
    for (let x = 0; x <= 420; x += 5) {
      for (let y = 0; y <= 297; y += 5) {
        expect(tiles.some((t) => x >= t.x0 && x <= t.x0 + t.w && y >= t.y0 && y <= t.y0 + t.h)).toBe(true);
      }
    }
    const [a, b] = tiles;
    expect(a.x0 + a.w - b.x0).toBeGreaterThanOrEqual(TILE_OVERLAP_MM);
    expect(tiles.every((t) => t.w <= 297 - 2 * TILE_MARGIN_MM && t.h <= 210 - 2 * TILE_MARGIN_MM)).toBe(true);
  });

  it('tiled PDF: 4 A4 landscape pages, each translating the sheet at TRUE scale into its printable area', () => {
    const pdf = text(exportPdf(doc(), { layout: 'a4-tiled' }));
    expect(pdf).toContain('/Count 4');
    expect((pdf.match(/\/MediaBox \[0 0 841\.8898 595\.2756\]/g) ?? []).length).toBe(4);
    const cms = [...pdf.matchAll(/\n1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const tiles = a4Tiles(420, 297);
    expect(cms).toHaveLength(4);
    cms.forEach(([tx, ty], i) => {
      expect(tx).toBeCloseTo((TILE_MARGIN_MM - tiles[i].x0) * PT_PER_MM, 3);
      expect(ty).toBeCloseTo((TILE_MARGIN_MM - tiles[i].y0) * PT_PER_MM, 3);
    });
    expect(pdf).toContain('(Page 1 of 4');
  });

  it('A4 fit: one page, reduced and labelled NOT TO SCALE', () => {
    const pdf = text(exportPdf(doc(), { layout: 'a4-fit' }));
    expect(pdf).toContain('/Count 1');
    expect(pdf).toMatch(/\(NOT TO SCALE \\226 sheet reduced to 6\d\.\d %/); // "–" encoded as WinAnsi 0x96
  });

  const poppler = (() => {
    try {
      execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!poppler)('poppler reads every layout (page counts and sizes)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'a3lay-'));
    for (const [layout, pages, size] of [
      ['a3', 1, /1190\.55 x 841\.89 pts \(A3\)/],
      ['a4-tiled', 4, /841\.89 x 595\.276 pts \(A4\)/],
      ['a4-fit', 1, /841\.89 x 595\.276 pts \(A4\)/],
    ] as const) {
      const f = path.join(dir, `${layout}.pdf`);
      writeFileSync(f, exportPdf(doc(), { layout }));
      const info = execFileSync('pdfinfo', [f], { encoding: 'utf8' });
      expect(info).toMatch(new RegExp(`Pages:\\s+${pages}`));
      expect(info).toMatch(size);
      expect(execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' })).toContain('Ground floor plan');
    }
  });
});

describe('PDF text encoding', () => {
  it('maps typographic and Latin-1 characters to WinAnsi instead of "?"', async () => {
    const { toWinAnsi } = await import('../src/storage/exportPdf');
    expect(toWinAnsi('A – B — C × 2 ± 0,5 µm é … “q” € ™ ⌀')).not.toContain(63);
    expect(toWinAnsi('–×')).toEqual([0x96, 0xd7]);
    expect(toWinAnsi('漢')).toEqual([63]);
  });
});
