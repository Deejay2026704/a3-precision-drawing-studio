import { scaleFactor } from '../geometry/scale';
import { vec, type Vec2 } from '../geometry/vec';
import { layoutDimension } from '../model/dimensions';
import { layerOf, resolveFill, resolveStroke, visibleDimensions, visibleShapes } from '../model/layers';
import { fillOutline, HATCH_WEIGHT_MM, hatchSegments } from '../model/fill';
import { rectCorners } from '../model/shapes';
import { titleBlockLayout } from '../model/titleBlock';
import type { ArrowheadStyle, DrawingDocument, Layer } from '../model/types';

/**
 * Device-independent drawing primitives for export, in PAPER millimetres with the
 * origin at the bottom-left of the sheet and Y UP (the same convention as PDF).
 * Only objects on VISIBLE layers are produced. Constraint markers, grid and
 * selection are never part of an export.
 */
export type Prim =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2; readonly stroke: string; readonly width: number }
  | { readonly kind: 'polyline'; readonly pts: readonly Vec2[]; readonly closed: boolean; readonly stroke: string; readonly width: number }
  | { readonly kind: 'circle'; readonly c: Vec2; readonly r: number; readonly stroke: string; readonly width: number }
  | { readonly kind: 'arc'; readonly c: Vec2; readonly r: number; readonly startDeg: number; readonly sweepDeg: number; readonly stroke: string; readonly width: number }
  | { readonly kind: 'fill'; readonly pts: readonly Vec2[]; readonly color: string }
  | { readonly kind: 'disc'; readonly c: Vec2; readonly r: number; readonly color: string }
  /** Text: centred on pos by default; anchor 'start' = left-aligned with the baseline at pos. */
  | { readonly kind: 'text'; readonly pos: Vec2; readonly rotationDeg: number; readonly height: number; readonly text: string; readonly color: string; readonly anchor?: 'start' };

export interface ExportItem {
  readonly id: string;
  readonly kind: 'shape' | 'dimension';
  readonly prims: readonly Prim[];
}

export interface ExportLayer {
  readonly layer: Layer;
  readonly items: readonly ExportItem[];
}

/** Dimension line weight on paper (mm). */
export const DIM_LINE_MM = 0.18;

function arrowPrims(tip: Vec2, dirDeg: number, size: number, style: ArrowheadStyle, color: string): Prim[] {
  const r = (dirDeg * Math.PI) / 180;
  const d = vec(Math.cos(r), Math.sin(r));
  const n = vec(-d.y, d.x);
  const back = vec(tip.x - d.x * size, tip.y - d.y * size);
  const w = size / 6;
  switch (style) {
    case 'closed':
      return [{ kind: 'fill', color, pts: [tip, vec(back.x + n.x * w, back.y + n.y * w), vec(back.x - n.x * w, back.y - n.y * w)] }];
    case 'open':
      return [{ kind: 'polyline', closed: false, stroke: color, width: DIM_LINE_MM, pts: [vec(back.x + n.x * w * 1.5, back.y + n.y * w * 1.5), tip, vec(back.x - n.x * w * 1.5, back.y - n.y * w * 1.5)] }];
    case 'tick': {
      const h = vec((d.x + n.x) * 0.35 * size, (d.y + n.y) * 0.35 * size);
      return [{ kind: 'line', stroke: color, width: DIM_LINE_MM * 2.5, a: vec(tip.x - h.x, tip.y - h.y), b: vec(tip.x + h.x, tip.y + h.y) }];
    }
    case 'dot':
      return [{ kind: 'disc', c: tip, r: size / 5, color }];
    case 'none':
      return [];
  }
}

export function drawingPrimitives(doc: DrawingDocument): ExportLayer[] {
  const k = scaleFactor(doc.scale);
  const P = (p: Vec2): Vec2 => vec(p.x * k, p.y * k);
  const shapes = visibleShapes(doc);
  const dims = visibleDimensions(doc);

  return doc.layers
    .filter((l) => l.visible)
    .map((layer) => {
      const items: ExportItem[] = [];
      for (const s of shapes) {
        if (layerOf(doc, s).id !== layer.id) continue;
        const stroke = resolveStroke(doc, s);
        const width = s.style.strokeWidthMm;
        let prim: Prim;
        switch (s.kind) {
          case 'line':
            prim = { kind: 'line', a: P(s.start), b: P(s.end), stroke, width };
            break;
          case 'rect':
            prim = { kind: 'polyline', pts: rectCorners(s).map(P), closed: true, stroke, width };
            break;
          case 'circle':
            prim = { kind: 'circle', c: P(s.center), r: s.radius * k, stroke, width };
            break;
          case 'arc':
            prim = { kind: 'arc', c: P(s.center), r: s.radius * k, startDeg: s.startDeg, sweepDeg: s.sweepDeg, stroke, width };
            break;
          case 'polyline':
            prim = { kind: 'polyline', pts: s.points.map(P), closed: !!s.closed, stroke, width };
            break;
        }
        // Fill/hatch first, so the outline is drawn on top of it.
        const fill = s.style.fill;
        const fillColor = resolveFill(doc, s);
        const under: Prim[] = [];
        if (fill && fillColor) {
          if (fill.pattern === 'solid') {
            const outline = s.kind === 'circle' ? null : fillOutline(s);
            if (s.kind === 'circle') under.push({ kind: 'disc', c: P(s.center), r: s.radius * k, color: fillColor });
            else if (outline) under.push({ kind: 'fill', pts: outline.map(P), color: fillColor });
          } else {
            for (const [a, b] of hatchSegments(s, fill, doc.scale) ?? []) under.push({ kind: 'line', a: P(a), b: P(b), stroke: fillColor, width: HATCH_WEIGHT_MM });
          }
        }
        items.push({ id: s.id, kind: 'shape', prims: [...under, prim] });
      }
      for (const d of dims) {
        if (layerOf(doc, d).id !== layer.id) continue;
        const lay = layoutDimension(doc, d, doc.scale);
        if (!lay) continue;
        const color = d.style.color;
        const prims: Prim[] = [
          ...lay.lines.map(([a, b]): Prim => ({ kind: 'line', a: P(a), b: P(b), stroke: color, width: DIM_LINE_MM })),
          ...lay.arcs.map((arc): Prim => ({ kind: 'arc', c: P(arc.center), r: arc.radius * k, startDeg: arc.startDeg, sweepDeg: arc.sweepDeg, stroke: color, width: DIM_LINE_MM })),
          ...lay.arrows.flatMap((ar) => arrowPrims(P(ar.tip), ar.dirDeg, lay.arrowSize * k, d.style.arrowhead, color)),
          { kind: 'text', pos: P(lay.textPos), rotationDeg: lay.textRotationDeg, height: lay.textHeight * k, text: lay.text, color },
        ];
        items.push({ id: d.id, kind: 'dimension', prims });
      }
      return { layer, items };
    });
}

/** Drawing frame + title block (paper mm), or [] when hidden. Part of the sheet, not of any layer. */
export function sheetPrimitives(doc: DrawingDocument): Prim[] {
  const tb = titleBlockLayout(doc);
  if (!tb) return [];
  const [frame, ...grid] = [tb.lines.slice(0, 4), tb.lines.slice(4)];
  return [
    ...frame.map(([a, b]): Prim => ({ kind: 'line', a, b, stroke: '#000000', width: tb.frameWeight })),
    ...grid.flat().map(([a, b]): Prim => ({ kind: 'line', a, b, stroke: '#000000', width: tb.gridWeight })),
    ...tb.texts.map((t): Prim => ({ kind: 'text', pos: t.pos, rotationDeg: 0, height: t.height, text: t.text, color: t.kind === 'label' ? '#5f6368' : '#000000', anchor: 'start' })),
  ];
}
