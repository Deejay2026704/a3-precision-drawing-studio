import { ASCENT, DESCENT, textWidth } from '../geometry/helvetica';
import { rotatePoint } from '../geometry/angles';
import { add, vec, type Vec2 } from '../geometry/vec';
import type { TextShape } from './types';

/** Baseline-to-baseline distance as a multiple of the font size. */
export const LINE_SPACING = 1.25;

export const textLines = (s: Pick<TextShape, 'text'>): string[] => s.text.split('\n');

/** Text box in the text's own frame (x along the baseline, y up), relative to `position`. */
export function textBoxLocal(s: TextShape): { minX: number; maxX: number; minY: number; maxY: number } {
  const lines = textLines(s);
  const w = Math.max(0, ...lines.map((l) => textWidth(l, s.height)));
  return { minX: 0, maxX: Math.max(w, s.height * 0.3), minY: -((lines.length - 1) * LINE_SPACING * s.height + DESCENT * s.height), maxY: ASCENT * s.height };
}

const toWorld = (s: TextShape, x: number, y: number): Vec2 => rotatePoint(add(s.position, vec(x, y)), s.position, s.rotationDeg);

/** The box corners in drawing mm: bottom-left, bottom-right, top-right, top-left. */
export function textCorners(s: TextShape): Vec2[] {
  const b = textBoxLocal(s);
  return [toWorld(s, b.minX, b.minY), toWorld(s, b.maxX, b.minY), toWorld(s, b.maxX, b.maxY), toWorld(s, b.minX, b.maxY)];
}

/** Start of each line's baseline, in drawing mm. */
export function lineBaselines(s: TextShape): { text: string; at: Vec2 }[] {
  return textLines(s).map((text, i) => ({ text, at: toWorld(s, 0, -i * LINE_SPACING * s.height) }));
}

export function textCenter(s: TextShape): Vec2 {
  const c = textCorners(s);
  return vec((c[0].x + c[2].x) / 2, (c[0].y + c[2].y) / 2);
}
