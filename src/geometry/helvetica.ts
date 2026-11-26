/**
 * Standard Helvetica font metrics (WinAnsi encoding), shared by text layout on the
 * canvas and the PDF writer, so text measures the same everywhere.
 */
// Helvetica advance widths (1/1000 em) for WinAnsi 32–126, plus ° and Ø.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Helvetica widths for common WinAnsi characters above 126 (others default to 556).
const EXTRA: Record<number, number> = {
  0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000,
  0xa0: 278, 0xa9: 737, 0xae: 737, 0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb5: 556, 0xb7: 278, 0xbc: 834, 0xbd: 834, 0xbe: 834,
  0xd7: 584, 0xd8: 778, 0xdf: 611, 0xe4: 556, 0xe8: 556, 0xe9: 556, 0xf6: 556, 0xf7: 584, 0xfc: 556,
};

/** Windows-1252 code points 0x80–0x9F that differ from Unicode. */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Map a Unicode string to WinAnsi (Windows-1252) codes for Helvetica. ⌀ → Ø; anything unsupported → ?. */
export function toWinAnsi(s: string): number[] {
  return [...s].map((ch) => {
    if (ch === '⌀') return 0xd8;
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) return c;
    if (c >= 0xa0 && c <= 0xff) return c; // Latin-1 is identical in WinAnsi
    return CP1252[c] ?? 63; // '?'
  });
}

export function textWidthPt(codes: number[], sizePt: number): number {
  return (codes.reduce((s, c) => s + (c >= 32 && c <= 126 ? W[c - 32] : (EXTRA[c] ?? 556)), 0) / 1000) * sizePt;
}

/** Width of a text in the same unit as `size` (e.g. mm for a size in mm). */
export const textWidth = (text: string, size: number): number => textWidthPt(toWinAnsi(text), size);

/** Helvetica ascender / descender as a fraction of the font size. */
export const ASCENT = 0.718;
export const DESCENT = 0.207;
