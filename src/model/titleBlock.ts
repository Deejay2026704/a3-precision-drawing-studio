import { formatScale } from '../geometry/scale';
import { vec, type Vec2 } from '../geometry/vec';
import type { DrawingDocument, TitleBlock } from './types';

/**
 * Drawing frame and title block layout, in PAPER millimetres (origin bottom-left, Y up).
 * Independent of the drawing scale: it is part of the sheet, not of the drawing.
 *
 *   frame: 10 mm from every sheet edge
 *   block: 180 × 40 mm in the bottom-right corner of the frame
 *   ┌──────────────────────────────────────────┐  16 mm  Title
 *   ├──────────────┬──────┬────────┬───────────┤  12 mm  Drawing no. | Rev | Scale | Sheet
 *   ├─────────┬────┴────┬─┴────────┴───────────┤  12 mm  Drawn by | Checked | Date | Company
 *   └─────────┴─────────┴──────────┴───────────┘
 */
export const FRAME_MARGIN_MM = 10;
export const BLOCK_W = 180;
export const BLOCK_H = 40;
const LABEL_H = 1.8;
const VALUE_H = 3.5;
const TITLE_H = 5;

export interface SheetText {
  readonly pos: Vec2;
  readonly height: number;
  readonly text: string;
  /** Text starts at pos (left aligned, baseline at pos.y). */
  readonly anchor: 'start';
  readonly kind: 'label' | 'value' | 'title';
}

export interface SheetLayout {
  readonly lines: readonly (readonly [Vec2, Vec2])[];
  readonly texts: readonly SheetText[];
  /** Line weights (paper mm). */
  readonly frameWeight: number;
  readonly gridWeight: number;
}

/** Clip a value so that it fits its cell (approximate glyph width 0.6 × height). */
export function fitText(text: string, widthMm: number, heightMm: number): string {
  const max = Math.max(0, Math.floor(widthMm / (0.6 * heightMm)));
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Null when the title block is hidden. */
export function titleBlockLayout(doc: Pick<DrawingDocument, 'page' | 'scale' | 'titleBlock'>): SheetLayout | null {
  const tb: TitleBlock = doc.titleBlock;
  if (!tb.visible) return null;
  const W = doc.page.widthMm;
  const H = doc.page.heightMm;
  const m = FRAME_MARGIN_MM;
  const lines: [Vec2, Vec2][] = [];
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    lines.push([vec(x0, y0), vec(x1, y0)], [vec(x1, y0), vec(x1, y1)], [vec(x1, y1), vec(x0, y1)], [vec(x0, y1), vec(x0, y0)]);
  };
  rect(m, m, W - m, H - m); // frame

  const x0 = W - m - BLOCK_W;
  const y0 = m;
  const texts: SheetText[] = [];
  const cell = (x: number, y: number, w: number, h: number, label: string, value: string, big = false) => {
    texts.push({ pos: vec(x + 1.5, y + h - 1 - LABEL_H), height: LABEL_H, text: label, anchor: 'start', kind: 'label' });
    const vh = big ? TITLE_H : VALUE_H;
    texts.push({ pos: vec(x + 1.5, y + 2), height: vh, text: fitText(value, w - 3, vh), anchor: 'start', kind: big ? 'title' : 'value' });
  };
  // outer block + row separators
  rect(x0, y0, x0 + BLOCK_W, y0 + BLOCK_H);
  lines.push([vec(x0, y0 + 24), vec(x0 + BLOCK_W, y0 + 24)], [vec(x0, y0 + 12), vec(x0 + BLOCK_W, y0 + 12)]);
  // top row: title
  cell(x0, y0 + 24, BLOCK_W, 16, 'TITLE', tb.title, true);
  // middle row: drawing no. 70 | rev 25 | scale 35 | sheet 50
  const mid: [number, string, string][] = [
    [70, 'DRAWING NO.', tb.drawingNumber],
    [25, 'REV', tb.revision],
    [35, 'SCALE', formatScale(doc.scale)],
    [50, 'SHEET', `A3 ${W} × ${H} mm`],
  ];
  // bottom row: drawn 45 | checked 45 | date 40 | company 50
  const bot: [number, string, string][] = [
    [45, 'DRAWN', tb.drawnBy],
    [45, 'CHECKED', tb.checkedBy],
    [40, 'DATE', tb.date],
    [50, 'COMPANY', tb.company],
  ];
  for (const [row, y] of [
    [mid, y0 + 12],
    [bot, y0],
  ] as const) {
    let x = x0;
    row.forEach(([w, label, value], i) => {
      cell(x, y, w, 12, label, value);
      x += w;
      if (i < row.length - 1) lines.push([vec(x, y), vec(x, y + 12)]);
    });
  }
  return { lines, texts, frameWeight: 0.5, gridWeight: 0.25 };
}
