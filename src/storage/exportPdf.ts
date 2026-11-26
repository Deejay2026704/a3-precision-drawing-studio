import type { Vec2 } from '../geometry/vec';
import type { DrawingDocument } from '../model/types';
import { drawingPrimitives, type Prim } from './drawingPrimitives';

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

// Helvetica advance widths (1/1000 em) for WinAnsi 32–126, plus ° and Ø.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const EXTRA: Record<number, number> = { 0xb0: 400, 0xd8: 778 };

/** Map a Unicode string to WinAnsi codes for Helvetica (⌀ → Ø; unknown → ?). */
export function toWinAnsi(s: string): number[] {
  return [...s].map((ch) => {
    if (ch === '⌀') return 0xd8;
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) return c;
    if (c === 0xb0 || c === 0xd8) return c;
    return 63; // '?'
  });
}

export function textWidthPt(codes: number[], sizePt: number): number {
  return (codes.reduce((s, c) => s + (c >= 32 && c <= 126 ? W[c - 32] : (EXTRA[c] ?? 556)), 0) / 1000) * sizePt;
}

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
      // Centre the text on pos (matches the screen/SVG rendering: middle anchor, central baseline).
      const dx = -textWidthPt(codes, size) / 2;
      const dy = -0.35 * size;
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

export function exportPdf(doc: DrawingDocument, opts: PdfOptions = {}): Uint8Array {
  const layers = drawingPrimitives(doc);
  const W_PT = pt(doc.page.widthMm);
  const H_PT = pt(doc.page.heightMm);

  // Object numbers: 1 catalog, 2 pages, 3 page, 4 font, 5 contents, 6 info, 7.. one OCG per layer.
  const ocgNum = (i: number) => 7 + i;
  const content = [
    '1 J 1 j',
    ...layers.map(({ items }, i) => [`/OC /L${i} BDC`, ...items.flatMap((it) => it.prims.map(primOps)).filter(Boolean), 'EMC'].join('\n')),
  ].join('\n');

  const ocgRefs = layers.map((_, i) => `${ocgNum(i)} 0 R`).join(' ');
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [${ocgRefs}] /D << /Order [${ocgRefs}] /ON [${ocgRefs}] >> >> >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W_PT)} ${num(H_PT)}] /Resources << /Font << /F1 4 0 R >> /Properties << ${layers
      .map((_, i) => `/L${i} ${ocgNum(i)} 0 R`)
      .join(' ')} >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${textString(opts.title ?? 'Drawing')} /Producer (A3 Precision Drawing Studio) /Creator (A3 Precision Drawing Studio) /Subject ${textString(
      `A3 sheet ${doc.page.widthMm} x ${doc.page.heightMm} mm, scale ${doc.scale.paper}:${doc.scale.real}`,
    )} /CreationDate (${pdfDate(opts.date ?? new Date())}) >>`,
    ...layers.map(({ layer }) => `<< /Type /OCG /Name ${textString(layer.name)} >>`),
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
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
