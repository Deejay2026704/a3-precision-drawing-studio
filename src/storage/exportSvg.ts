import { vec, type Vec2 } from '../geometry/vec';
import type { DrawingDocument } from '../model/types';
import { drawingPrimitives, sheetPrimitives, type Prim } from './drawingPrimitives';

/**
 * Export the drawing as an SVG sized to the physical sheet (420 × 297 mm).
 * Only objects on VISIBLE layers are exported; each layer becomes a <g> group.
 * Coordinates are paper millimetres (viewBox units = mm), Y flipped for SVG.
 */
const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportSvg(doc: DrawingDocument): string {
  const H = doc.page.heightMm;
  const F = (p: Vec2): Vec2 => vec(p.x, H - p.y); // paper (Y up) → SVG (Y down)
  const pts = (ps: readonly Vec2[]) => ps.map(F).map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

  const shapeAttrs = (stroke: string, width: number, id: string) =>
    `fill="none" stroke="${esc(stroke)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" data-id="${esc(id)}"`;
  const dimAttrs = (stroke: string, width: number) => `stroke="${esc(stroke)}" stroke-width="${n(width)}"`;

  const prim = (p: Prim, id: string | null): string => {
    const attrs = (stroke: string, width: number) => (id ? shapeAttrs(stroke, width, id) : `fill="none" ${dimAttrs(stroke, width)}`);
    switch (p.kind) {
      case 'line': {
        const a = F(p.a);
        const b = F(p.b);
        return `<line ${id ? shapeAttrs(p.stroke, p.width, id) : dimAttrs(p.stroke, p.width)} x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"/>`;
      }
      case 'polyline':
        return `<${p.closed ? 'polygon' : 'polyline'} ${attrs(p.stroke, p.width)} points="${pts(p.pts)}"/>`;
      case 'circle': {
        const c = F(p.c);
        return `<circle ${attrs(p.stroke, p.width)} cx="${n(c.x)}" cy="${n(c.y)}" r="${n(p.r)}"/>`;
      }
      case 'arc': {
        const at = (deg: number) => F(vec(p.c.x + p.r * Math.cos((deg * Math.PI) / 180), p.c.y + p.r * Math.sin((deg * Math.PI) / 180)));
        const s0 = at(p.startDeg);
        const s1 = at(p.startDeg + p.sweepDeg);
        return `<path fill="none" ${dimAttrs(p.stroke, p.width)} d="M ${n(s0.x)} ${n(s0.y)} A ${n(p.r)} ${n(p.r)} 0 ${p.sweepDeg > 180 ? 1 : 0} 0 ${n(s1.x)} ${n(s1.y)}"/>`;
      }
      case 'fill':
        return `<polygon fill="${esc(p.color)}" points="${pts(p.pts)}"/>`;
      case 'disc': {
        const c = F(p.c);
        return `<circle fill="${esc(p.color)}" cx="${n(c.x)}" cy="${n(c.y)}" r="${n(p.r)}"/>`;
      }
      case 'text': {
        const t = F(p.pos);
        const align = p.anchor === 'start' ? 'text-anchor="start"' : 'text-anchor="middle" dominant-baseline="central"';
        return `<text x="${n(t.x)}" y="${n(t.y)}" font-size="${n(p.height)}" font-family="Arial, sans-serif" fill="${esc(p.color)}" ${align} transform="rotate(${n(-p.rotationDeg)} ${n(t.x)} ${n(t.y)})">${esc(p.text)}</text>`;
      }
    }
  };

  const sheet = sheetPrimitives(doc);
  const sheetGroup = sheet.length ? [`  <g id="title-block">\n    ${sheet.map((p) => prim(p, null)).join('\n    ')}\n  </g>`] : [];
  const groups = drawingPrimitives(doc).map(({ layer, items }) => {
    const body = items.map((it) =>
      it.kind === 'shape' ? it.prims.map((p) => prim(p, it.id)).join('') : `<g class="dimension" data-id="${esc(it.id)}">${it.prims.map((p) => prim(p, null)).join('')}</g>`,
    );
    return `  <g id="layer-${esc(layer.id)}" data-layer-name="${esc(layer.name)}">\n    ${body.join('\n    ')}\n  </g>`;
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(doc.page.widthMm)}mm" height="${n(doc.page.heightMm)}mm" viewBox="0 0 ${n(doc.page.widthMm)} ${n(doc.page.heightMm)}">`,
    `  <title>A3 Precision Drawing Studio export – scale ${doc.scale.paper}:${doc.scale.real}</title>`,
    `  <rect width="${n(doc.page.widthMm)}" height="${n(doc.page.heightMm)}" fill="#ffffff"/>`,
    ...sheetGroup,
    ...groups,
    `</svg>`,
    '',
  ].join('\n');
}
