import { scaleFactor } from '../geometry/scale';
import { vec, type Vec2 } from '../geometry/vec';
import { layoutDimension } from '../model/dimensions';
import { layerOf, resolveStroke, visibleDimensions, visibleShapes } from '../model/layers';
import { rectCorners } from '../model/shapes';
import type { ArrowheadStyle, DrawingDocument, Shape } from '../model/types';

/**
 * Export the drawing as an SVG sized to the physical sheet (420 × 297 mm).
 * Only objects on VISIBLE layers are exported; each layer becomes a <g> group.
 * Coordinates are paper millimetres (viewBox units = mm), Y flipped for SVG.
 * Constraint markers, grid and selection are never exported.
 */
const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportSvg(doc: DrawingDocument): string {
  const k = scaleFactor(doc.scale);
  const H = doc.page.heightMm;
  const P = (p: Vec2): Vec2 => vec(p.x * k, H - p.y * k);
  const pts = (ps: readonly Vec2[]) => ps.map(P).map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

  const shapeSvg = (s: Shape): string => {
    const a = `fill="none" stroke="${esc(resolveStroke(doc, s))}" stroke-width="${n(s.style.strokeWidthMm)}" stroke-linecap="round" stroke-linejoin="round" data-id="${esc(s.id)}"`;
    switch (s.kind) {
      case 'line': {
        const p = P(s.start);
        const q = P(s.end);
        return `<line ${a} x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}"/>`;
      }
      case 'rect':
        return `<polygon ${a} points="${pts(rectCorners(s))}"/>`;
      case 'circle': {
        const c = P(s.center);
        return `<circle ${a} cx="${n(c.x)}" cy="${n(c.y)}" r="${n(s.radius * k)}"/>`;
      }
      case 'polyline':
        return `<polyline ${a} points="${pts(s.points)}"/>`;
    }
  };

  const arrow = (tip: Vec2, dirDeg: number, size: number, style: ArrowheadStyle, color: string): string => {
    const t = P(tip);
    const r = (dirDeg * Math.PI) / 180;
    const d = vec(Math.cos(r), -Math.sin(r));
    const nn = vec(-d.y, d.x);
    const b = vec(t.x - d.x * size, t.y - d.y * size);
    const w = size / 6;
    switch (style) {
      case 'closed':
        return `<polygon fill="${color}" points="${n(t.x)},${n(t.y)} ${n(b.x + nn.x * w)},${n(b.y + nn.y * w)} ${n(b.x - nn.x * w)},${n(b.y - nn.y * w)}"/>`;
      case 'open':
        return `<polyline fill="none" stroke="${color}" stroke-width="0.18" points="${n(b.x + nn.x * w * 1.5)},${n(b.y + nn.y * w * 1.5)} ${n(t.x)},${n(t.y)} ${n(b.x - nn.x * w * 1.5)},${n(b.y - nn.y * w * 1.5)}"/>`;
      case 'tick': {
        const h = vec((d.x + nn.x) * 0.35 * size, (d.y + nn.y) * 0.35 * size);
        return `<line stroke="${color}" stroke-width="0.45" x1="${n(t.x - h.x)}" y1="${n(t.y - h.y)}" x2="${n(t.x + h.x)}" y2="${n(t.y + h.y)}"/>`;
      }
      case 'dot':
        return `<circle fill="${color}" cx="${n(t.x)}" cy="${n(t.y)}" r="${n(size / 5)}"/>`;
      case 'none':
        return '';
    }
  };

  const groups = doc.layers
    .filter((l) => l.visible)
    .map((l) => {
      const shapes = visibleShapes(doc).filter((s) => layerOf(doc, s).id === l.id).map(shapeSvg);
      const dims = visibleDimensions(doc)
        .filter((d) => layerOf(doc, d).id === l.id)
        .map((d) => {
          const lay = layoutDimension(doc, d, doc.scale);
          if (!lay) return '';
          const c = esc(d.style.color);
          const lines = lay.lines.map(([a, b]) => {
            const p = P(a);
            const q = P(b);
            return `<line stroke="${c}" stroke-width="0.18" x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}"/>`;
          });
          const arcs = lay.arcs.map((arc) => {
            const at = (deg: number) => P(vec(arc.center.x + arc.radius * Math.cos((deg * Math.PI) / 180), arc.center.y + arc.radius * Math.sin((deg * Math.PI) / 180)));
            const s0 = at(arc.startDeg);
            const s1 = at(arc.startDeg + arc.sweepDeg);
            return `<path fill="none" stroke="${c}" stroke-width="0.18" d="M ${n(s0.x)} ${n(s0.y)} A ${n(arc.radius * k)} ${n(arc.radius * k)} 0 ${arc.sweepDeg > 180 ? 1 : 0} 0 ${n(s1.x)} ${n(s1.y)}"/>`;
          });
          const arrows = lay.arrows.map((ar) => arrow(ar.tip, ar.dirDeg, lay.arrowSize * k, d.style.arrowhead, c));
          const tp = P(lay.textPos);
          const text = `<text x="${n(tp.x)}" y="${n(tp.y)}" font-size="${n(lay.textHeight * k)}" font-family="Arial, sans-serif" fill="${c}" text-anchor="middle" dominant-baseline="central" transform="rotate(${n(-lay.textRotationDeg)} ${n(tp.x)} ${n(tp.y)})">${esc(lay.text)}</text>`;
          return `<g class="dimension" data-id="${esc(d.id)}">${[...lines, ...arcs, ...arrows, text].join('')}</g>`;
        });
      return `  <g id="layer-${esc(l.id)}" data-layer-name="${esc(l.name)}">\n    ${[...shapes, ...dims].join('\n    ')}\n  </g>`;
    });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(doc.page.widthMm)}mm" height="${n(doc.page.heightMm)}mm" viewBox="0 0 ${n(doc.page.widthMm)} ${n(doc.page.heightMm)}">`,
    `  <title>A3 Precision Drawing Studio export – scale ${doc.scale.paper}:${doc.scale.real}</title>`,
    `  <rect width="${n(doc.page.widthMm)}" height="${n(doc.page.heightMm)}" fill="#ffffff"/>`,
    ...groups,
    `</svg>`,
    '',
  ].join('\n');
}
