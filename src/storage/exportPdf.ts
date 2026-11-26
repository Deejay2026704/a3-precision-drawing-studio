import type { Vec2 } from '../geometry/vec';
import type { DrawingDocument } from '../model/types';
import { drawingPrimitives, sheetPrimitives, type Prim } from './drawingPrimitives';

/**
 * Vector PDF export at TRUE SCALE.
 *
 * One page the size of the sheet (A3 landscape = 1190.551 × 841.890 pt). Paper millimetres
 * map to points by 72 / 25.4, and PDF's origin is bottom-left with Y up – the same as the
 * drawing's paper coordinates, so no flipping is needed. Print at "Actual size / 100 %"
 * and 100 mm on screen is 100 mm on paper (× the drawing scale).
 *
 * Only VISIBLE layers are exported; each becomes a PDF layer (optional content group) that
 * PDF viewers can toggle. Text uses the standard Helvetica font (no embedding needed).
 * Circles/arcs are cubic Béziers with ≤ 22.5° segments (radial error < 1e-6 × radius).
 * The writer is pure (no Electron, no DOM) and deterministic for a given date.
 */
export const PT_PER_MM = 72 / 25.4;

export interface PdfOptions {
  readonly title?: string;
  /** Fixed creation date (for reproducible output); default: now. */
  readonly date?: Date;
}

export { textWidthPt, toWinAnsi } from '../geometry/helvetica';
import { textWidthPt, toWinAnsi } from '../geometry/helvetica';

const num = (v: number): string => {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (mm: number) => mm * PT_PER_MM;
const P = (p: Vec2) => `${num(pt(p.x))} ${num(pt(p.y))}`;

function rgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '0 0 0';
  return [m[1], m[2], m[3]].map((h) => num(parseInt(h, 16) / 255)).join(' ');
}

/** PDF literal string for WinAnsi codes. */
const literal = (codes: number[]) =>
  '(' + codes.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('') + ')';

/** Text string for metadata / layer names: ASCII literal, otherwise UTF-16BE hex. */
function textString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return literal([...s].map((c) => c.charCodeAt(0)));
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** Bézier path for an arc (mm, CCW from startDeg). `move` starts a new subpath. */
function arcPath(c: Vec2, r: number, startDeg: number, sweepDeg: number, move: boolean): string {
  const segs = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 22.5));
  const step = ((sweepDeg / segs) * Math.PI) / 180;
  const kk = (4 / 3) * Math.tan(step / 4);
  let a = (startDeg * Math.PI) / 180;
  const at = (t: number) => ({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  const out: string[] = [];
  if (move) out.push(`${P(at(a))} m`);
  for (let i = 0; i < segs; i++) {
    const b = a + step;
    const p0 = at(a);
    const p3 = at(b);
    const c1 = { x: p0.x - kk * r * Math.sin(a), y: p0.y + kk * r * Math.cos(a) };
    const c2 = { x: p3.x + kk * r * Math.sin(b), y: p3.y - kk * r * Math.cos(b) };
    out.push(`${P(c1)} ${P(c2)} ${P(p3)} c`);
    a = b;
  }
  return out.join('\n');
}

function primOps(p: Prim): string {
  const stroke = (color: string, width: number) => `${rgb(color)} RG ${num(pt(width))} w`;
  switch (p.kind) {
    case 'line':
      return `${stroke(p.stroke, p.width)}\n${P(p.a)} m ${P(p.b)} l S`;
    case 'polyline': {
      if (p.pts.length === 0) return '';
      const path = p.pts.map((q, i) => `${P(q)} ${i === 0 ? 'm' : 'l'}`).join(' ');
      return `${stroke(p.stroke, p.width)}\n${path}${p.closed ? ' h' : ''} S`;
    }
    case 'circle':
      return `${stroke(p.stroke, p.width)}\n${arcPath(p.c, p.r, 0, 360, true)} h S`;
    case 'arc':
      return `${stroke(p.stroke, p.width)}\n${arcPath(p.c, p.r, p.startDeg, p.sweepDeg, true)} S`;
    case 'fill':
      return `${rgb(p.color)} rg\n${p.pts.map((q, i) => `${P(q)} ${i === 0 ? 'm' : 'l'}`).join(' ')} h f`;
    case 'disc':
      return `${rgb(p.color)} rg\n${arcPath(p.c, p.r, 0, 360, true)} h f`;
    case 'text': {
      const codes = toWinAnsi(p.text);
      const size = pt(p.height);
      const r = (p.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      // Default: centre the text on pos (matches the screen/SVG rendering: middle anchor,
      // central baseline). anchor 'start': left-aligned with the baseline at pos.
      const dx = p.anchor === 'start' ? 0 : -textWidthPt(codes, size) / 2;
      const dy = p.anchor === 'start' ? 0 : -0.35 * size;
      const x = pt(p.pos.x) + dx * cos - dy * sin;
      const y = pt(p.pos.y) + dx * sin + dy * cos;
      return `${rgb(p.color)} rg\nBT /F1 ${num(size)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(x)} ${num(y)} Tm ${literal(codes)} Tj ET`;
    }
  }
}

const pdfDate = (d: Date) => {
  const z = (v: number) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
};

/**
 * Print layouts:
 *  - 'a3'       one page the size of the sheet, true scale (default);
 *  - 'a4-tiled' the sheet split over A4 landscape pages at TRUE SCALE, with a 10 mm margin
 *               (printer-safe), 10 mm overlap between neighbours, corner marks and labels;
 *  - 'a4-fit'   the whole sheet reduced onto one A4 landscape page – marked NOT TO SCALE;
 *  - 'letter-tiled' / 'letter-fit': the same on US Letter (11 × 8.5 in) paper.
 */
export type PdfLayout = 'a3' | 'a4-tiled' | 'a4-fit' | 'letter-tiled' | 'letter-fit';

export interface Paper {
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
}
export const A4_LANDSCAPE = { name: 'A4', widthMm: 297, heightMm: 210 } as const;
/** US Letter, 11 × 8.5 in. */
export const LETTER_LANDSCAPE = { name: 'Letter', widthMm: 279.4, heightMm: 215.9 } as const;
export const paperFor = (layout: PdfLayout): Paper => (layout.startsWith('letter') ? LETTER_LANDSCAPE : A4_LANDSCAPE);
export const TILE_MARGIN_MM = 10;
export const TILE_OVERLAP_MM = 10;

export interface Tile {
  readonly row: number;
  readonly col: number;
  /** Sheet region shown on this page (paper mm). */
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

/** Tiles covering a sheet with A4 landscape pages (printable area minus margins, with overlap). */
export const a4Tiles = (sheetW: number, sheetH: number): Tile[] => paperTiles(sheetW, sheetH, A4_LANDSCAPE);

/** Tiles covering a sheet with landscape pages of `paper` (printable area minus margins, with overlap). */
export function paperTiles(sheetW: number, sheetH: number, paper: Paper): Tile[] {
  const pw = paper.widthMm - 2 * TILE_MARGIN_MM;
  const ph = paper.heightMm - 2 * TILE_MARGIN_MM;
  const step = (p: number) => p - TILE_OVERLAP_MM;
  const count = (sheet: number, p: number) => (sheet <= p ? 1 : Math.ceil((sheet - TILE_OVERLAP_MM) / step(p)));
  const cols = count(sheetW, pw);
  const rows = count(sheetH, ph);
  const tiles: Tile[] = [];
  // Top row first (reading order); the last tile in each direction is aligned to the sheet edge.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.min(c * step(pw), Math.max(0, sheetW - pw));
      const yTop = Math.max(sheetH - r * step(ph), Math.min(sheetH, ph));
      const y0 = Math.max(0, yTop - ph);
      tiles.push({ row: r + 1, col: c + 1, x0, y0, w: Math.min(pw, sheetW), h: Math.min(ph, sheetH) });
    }
  }
  return tiles;
}

const pdfDateFor = (opts: PdfOptions) => pdfDate(opts.date ?? new Date());

export function exportPdf(doc: DrawingDocument, opts: PdfOptions & { layout?: PdfLayout } = {}): Uint8Array {
  const layout = opts.layout ?? 'a3';
  const paper = paperFor(layout);
  const layers = drawingPrimitives(doc);
  const sheet = sheetPrimitives(doc);
  const sheetW = doc.page.widthMm;
  const sheetH = doc.page.heightMm;

  // Optional content groups: one per visible layer (+ title block). Numbers assigned below.
  const groups = [...(sheet.length ? [{ name: 'Title block' }] : []), ...layers.map(({ layer }) => ({ name: layer.name }))];
  const drawingOps = [
    '1 J 1 j',
    ...(sheet.length ? [[`/OC /L0 BDC`, ...sheet.map(primOps).filter(Boolean), 'EMC'].join('\n')] : []),
    ...layers.map(({ items }, i) => [`/OC /L${i + (sheet.length ? 1 : 0)} BDC`, ...items.flatMap((it) => it.prims.map(primOps)).filter(Boolean), 'EMC'].join('\n')),
  ].join('\n');

  const label = (x: number, y: number, size: number, text: string) => `0 0 0 rg\nBT /F1 ${num(size)} Tf 1 0 0 1 ${num(pt(x))} ${num(pt(y))} Tm ${literal(toWinAnsi(text))} Tj ET`;

  interface Page {
    widthMm: number;
    heightMm: number;
    content: string;
  }
  let pages: Page[];
  if (layout === 'a3') {
    pages = [{ widthMm: sheetW, heightMm: sheetH, content: drawingOps }];
  } else if (layout === 'a4-tiled' || layout === 'letter-tiled') {
    const tiles = paperTiles(sheetW, sheetH, paper);
    const rows = Math.max(...tiles.map((t) => t.row));
    const cols = Math.max(...tiles.map((t) => t.col));
    const m = TILE_MARGIN_MM;
    pages = tiles.map((t, i) => {
      const mark = (x: number, y: number, dx: number, dy: number) => `${num(pt(x))} ${num(pt(y))} m ${num(pt(x + dx))} ${num(pt(y + dy))} l S`;
      const W = m + t.w;
      const H = m + t.h;
      const marks = [
        '0 0 0 RG 0.25 w',
        mark(m, m, -5, 0), mark(m, m, 0, -5), mark(W, m, 5, 0), mark(W, m, 0, -5),
        mark(m, H, -5, 0), mark(m, H, 0, 5), mark(W, H, 5, 0), mark(W, H, 0, 5),
      ].join('\n');
      const text = label(m, 4, 2.5, `Page ${i + 1} of ${tiles.length} – row ${t.row}/${rows}, column ${t.col}/${cols} – sheet x ${num(t.x0)}–${num(t.x0 + t.w)} mm, y ${num(t.y0)}–${num(t.y0 + t.h)} mm – print at 100 % (actual size); overlap ${TILE_OVERLAP_MM} mm`);
      const content = [
        'q',
        `${num(pt(m))} ${num(pt(m))} ${num(pt(t.w))} ${num(pt(t.h))} re W n`,
        `1 0 0 1 ${num(pt(m - t.x0))} ${num(pt(m - t.y0))} cm`,
        drawingOps,
        'Q',
        marks,
        text,
      ].join('\n');
      return { widthMm: paper.widthMm, heightMm: paper.heightMm, content };
    });
  } else {
    const m = TILE_MARGIN_MM;
    const k = Math.min((paper.widthMm - 2 * m) / sheetW, (paper.heightMm - 2 * m - 6) / sheetH);
    const ox = (paper.widthMm - sheetW * k) / 2;
    const oy = m + 6;
    const content = [
      'q',
      `${num(k)} 0 0 ${num(k)} ${num(pt(ox))} ${num(pt(oy))} cm`,
      `0.6 0.6 0.6 RG ${num(pt(0.2 / k))} w 0 0 ${num(pt(sheetW))} ${num(pt(sheetH))} re S`,
      drawingOps,
      'Q',
      label(m, m, 3.5, `NOT TO SCALE – sheet reduced to ${(k * 100).toFixed(1)} % to fit ${paper.name}. Use the A3 or a tiled layout for true scale.`),
    ].join('\n');
    pages = [{ widthMm: paper.widthMm, heightMm: paper.heightMm, content }];
  }

  // Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then OCGs, then (page, contents) pairs.
  const ocgNum = (i: number) => 5 + i;
  const pageNum = (i: number) => 5 + groups.length + 2 * i;
  const ocgRefs = groups.map((_, i) => `${ocgNum(i)} 0 R`).join(' ');
  const props = groups.map((_, i) => `/L${i} ${ocgNum(i)} 0 R`).join(' ');
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${ocgRefs}] /D << /Order [${ocgRefs}] /ON [${ocgRefs}] >> >> >>`,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Title ${textString(opts.title ?? 'Drawing')} /Producer (A3 Precision Drawing Studio) /Creator (A3 Precision Drawing Studio) /Subject ${textString(
      `A3 sheet ${sheetW} x ${sheetH} mm, scale ${doc.scale.paper}:${doc.scale.real}, layout ${layout}`,
    )} /CreationDate (${pdfDateFor(opts)}) >>`,
    ...groups.map((g) => `<< /Type /OCG /Name ${textString(g.name)} >>`),
    ...pages.flatMap((pg, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pt(pg.widthMm))} ${num(pt(pg.heightMm))}] /Resources << /Font << /F1 3 0 R >> /Properties << ${props} >> >> /Contents ${pageNum(i) + 1} 0 R >>`,
      `<< /Length ${pg.content.length} >>\nstream\n${pg.content}\nendstream`,
    ]),
  ];

  // Assemble with exact byte offsets (everything is 8-bit; the content is ASCII).
  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
