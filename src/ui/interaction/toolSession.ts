import { distance, type Vec2 } from '../../geometry/vec';
import { formatNumber } from '../../geometry/units';
import { addDimensions, getShapes } from '../../model/document';
import {
  createAngularDimension,
  createLinearDimension,
  createRadialDimension,
  type DimResult,
} from '../../model/dimensions';
import { distanceToShape } from '../../model/hitTest';
import { extendLine, mirrorShape, mirrorShapes, offsetShape, trimPreviewShape, trimShape, type EditResult } from '../../model/modify';
import { chamferLines, filletLines } from '../../model/curves';
import type { SnapResult } from '../../model/snap';
import { createArc, createLine, createPolygon, createPolyline, polylineLength } from '../../model/shapes';
import { arcThroughPoints } from '../../geometry/arc';
import { BY_LAYER, type DimAnchor, type Dimension, type DimensionStyle, type DrawingDocument, type Shape, type ShapeId, type ShapeKind, type ShapeStyle, type TextShape } from '../../model/types';

const DEFAULT_TEXT_STYLE: ShapeStyle = { stroke: BY_LAYER, strokeWidthMm: 0.25 };
import type { ConstraintToolId, DimensionToolId, ModifyToolId } from '../state/editorReducer';
import { addConstraint } from '../../model/constraints';
import { shapeKeyPoints } from '../../model/anchors';
import type { PointRef } from '../../model/types';

/**
 * Click-driven tools (modify + dimension) as a pure state machine.
 * The canvas feeds it snapped clicks; it returns either "continue" (with a prompt),
 * a document to commit (one undo step), or a refusal message. No DOM, no React.
 */
export type SessionTool = 'arc' | 'polyline' | 'polygon' | 'text' | ModifyToolId | DimensionToolId | ConstraintToolId;

export interface ToolSession {
  readonly tool: SessionTool;
  readonly points: readonly Vec2[];
  readonly anchors: readonly DimAnchor[];
  readonly picks: readonly ShapeId[];
  /** Points picked by the constraint tools. */
  readonly refs?: readonly PointRef[];
}

export const newSession = (tool: SessionTool): ToolSession => ({ tool, points: [], anchors: [], picks: [] });
export const sessionInProgress = (s: ToolSession | null): boolean => !!s && (s.points.length > 0 || s.picks.length > 0);

export interface ToolInput {
  readonly doc: DrawingDocument;
  readonly selection: readonly ShapeId[];
  /** Snapped point (drawing mm). */
  readonly point: Vec2;
  /** Raw cursor (drawing mm) – used for picking objects and sides. */
  readonly raw: Vec2;
  readonly snap: SnapResult | null;
  /** Pick tolerance in drawing mm. */
  readonly tolerance: number;
  readonly dimStyle: DimensionStyle;
  readonly offsetDistanceMm: number;
  readonly mirrorKeepSource: boolean;
  readonly newId: () => ShapeId;
  /** Objects that may be modified/selected (visible, unlocked layer). Default: all. */
  readonly canEdit?: (s: Shape) => boolean;
  /** Objects that are visible (may be measured or snapped to). Default: all. */
  readonly canSee?: (s: Shape) => boolean;
  /** Pen for new objects (arc tool). */
  readonly drawStyle?: ShapeStyle;
  readonly filletRadiusMm?: number;
  readonly chamferDistanceMm?: number;
  readonly polygonSides?: number;
  /** Text tool: font size of new text in DRAWING mm (already converted from paper mm). */
  readonly textHeight?: number;
}

export type ToolStep =
  | { readonly kind: 'continue'; readonly session: ToolSession; readonly prompt: string; readonly selection?: readonly ShapeId[] }
  | { readonly kind: 'commit'; readonly session: ToolSession; readonly doc: DrawingDocument; readonly selection: readonly ShapeId[]; readonly message: string }
  | { readonly kind: 'error'; readonly session: ToolSession; readonly message: string };

/** Topmost shape under the cursor, optionally restricted to some kinds. */
export function pickShape(doc: DrawingDocument, p: Vec2, tolerance: number, kinds?: readonly ShapeKind[], allow: (s: Shape) => boolean = () => true): Shape | null {
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i];
    if (kinds && !kinds.includes(s.kind)) continue;
    if (!allow(s)) continue;
    if (distanceToShape(s, p) <= tolerance) return s;
  }
  return null;
}

const fromEdit = (session: ToolSession, r: EditResult): ToolStep =>
  r.ok ? { kind: 'commit', session, doc: r.doc, selection: r.selection, message: r.message } : { kind: 'error', session, message: r.message };

const fromDim = (session: ToolSession, doc: DrawingDocument, r: DimResult<Dimension>, label: string): ToolStep =>
  r.ok
    ? { kind: 'commit', session, doc: addDimensions(doc, [r.value]), selection: [r.value.id], message: label }
    : { kind: 'error', session, message: r.message };

const anchorOf = (snap: SnapResult | null, point: Vec2): DimAnchor =>
  snap?.anchor ? { kind: 'shape', shapeId: snap.anchor.shapeId, key: snap.anchor.key } : { kind: 'point', point };

const LINEAR: Record<string, 'aligned' | 'horizontal' | 'vertical'> = {
  'dim-aligned': 'aligned',
  'dim-horizontal': 'horizontal',
  'dim-vertical': 'vertical',
};

/** Nearest constrainable point (line start/end/mid, circle centre) within tolerance. */
export function pickPointRef(doc: DrawingDocument, p: Vec2, tolerance: number, allow: (s: Shape) => boolean = () => true): PointRef | null {
  let best: { ref: PointRef; d: number } | null = null;
  for (const s of doc.shapes) {
    if ((s.kind !== 'line' && s.kind !== 'circle' && s.kind !== 'arc') || !allow(s)) continue;
    for (const kp of shapeKeyPoints(s)) {
      if (kp.key !== 'start' && kp.key !== 'end' && kp.key !== 'mid' && kp.key !== 'center') continue;
      const d = distance(kp.point, p);
      if (d <= tolerance && (!best || d < best.d)) best = { ref: { shapeId: s.id, key: kp.key }, d };
    }
  }
  return best?.ref ?? null;
}

export function toolClick(session: ToolSession, input: ToolInput): ToolStep {
  const { doc, raw, point, tolerance } = input;
  const reset = newSession(session.tool);
  const canEdit = input.canEdit ?? (() => true);
  const canSee = input.canSee ?? (() => true);

  switch (session.tool) {
    case 'text': {
      const t: TextShape = { id: input.newId(), kind: 'text', position: point, text: 'Text', height: input.textHeight ?? 3.5, rotationDeg: 0, style: input.drawStyle ?? DEFAULT_TEXT_STYLE };
      return { kind: 'commit', session: reset, doc: { ...doc, shapes: [...doc.shapes, t] }, selection: [t.id], message: 'Text placed – type the text in Properties (Ctrl+Enter or click away to apply)' };
    }
    case 'polyline': {
      const prev = session.points;
      if (prev.length > 0 && distance(point, prev[prev.length - 1]) < 1e-9) {
        // Second click of a double-click (or a repeated click): nothing to add.
        return { kind: 'continue', session, prompt: POLY_PROMPT };
      }
      if (prev.length >= 3 && distance(raw, prev[0]) <= tolerance) return commitPolyline(session, input, prev, true);
      return { kind: 'continue', session: { ...session, points: [...prev, point] }, prompt: prev.length === 0 ? 'Polyline: click the next point' : POLY_PROMPT };
    }
    case 'polygon': {
      const sides = input.polygonSides ?? 6;
      if (session.points.length === 0) return { kind: 'continue', session: { ...session, points: [point] }, prompt: `Polygon (${sides} sides): click a corner` };
      const c = session.points[0];
      const r = distance(c, point);
      if (r < 1e-9) return { kind: 'error', session, message: 'The corner coincides with the centre' };
      const rot = (Math.atan2(point.y - c.y, point.x - c.x) * 180) / Math.PI;
      const poly = createPolygon(input.newId(), c, r, sides, rot, input.drawStyle);
      return { kind: 'commit', session: reset, doc: { ...doc, shapes: [...doc.shapes, poly] }, selection: [poly.id], message: `Polygon created – ${sides} sides, radius ${formatNumber(r)} mm` };
    }
    case 'arc': {
      const pts = [...session.points, point];
      if (pts.length >= 2 && distance(pts[pts.length - 1], pts[pts.length - 2]) < 1e-9) {
        return { kind: 'error', session, message: 'That point coincides with the previous one' };
      }
      if (pts.length < 3) {
        return { kind: 'continue', session: { ...session, points: pts }, prompt: pts.length === 1 ? 'Arc: click a point on the arc' : 'Arc: click the end point' };
      }
      const g = arcThroughPoints(pts[0], pts[1], pts[2]);
      if (!g) return { kind: 'error', session: { ...session, points: pts.slice(0, 2) }, message: 'The three points are in a straight line – pick a different end point' };
      const arc = createArc(input.newId(), g.c, g.r, g.startDeg, g.sweepDeg, input.drawStyle);
      return { kind: 'commit', session: reset, doc: { ...doc, shapes: [...doc.shapes, arc] }, selection: [arc.id], message: `Arc created – radius ${formatNumber(g.r)} mm, ${formatNumber(g.sweepDeg)}°` };
    }
    case 'trim':
    case 'extend': {
      const s = pickShape(doc, raw, tolerance, undefined, canEdit);
      if (!s) return { kind: 'error', session, message: `Click on ${session.tool === 'trim' ? 'a line, circle, arc or polyline to trim' : 'a line to extend'} (objects on locked or hidden layers cannot be changed)` };
      return fromEdit(session, session.tool === 'trim' ? trimShape(doc, s.id, raw, input.newId) : extendLine(doc, s.id, raw));
    }

    case 'fillet':
    case 'chamfer': {
      const l = pickShape(doc, raw, tolerance, ['line'], canEdit);
      if (!l) return { kind: 'error', session, message: 'Click on a line (on the side you want to keep)' };
      if (session.picks.length === 0) {
        return { kind: 'continue', session: { ...session, picks: [l.id], points: [raw] }, selection: [l.id], prompt: `${session.tool === 'fillet' ? 'Fillet' : 'Chamfer'}: click the second line on the side to keep` };
      }
      const r =
        session.tool === 'fillet'
          ? filletLines(doc, session.picks[0], session.points[0], l.id, raw, input.filletRadiusMm ?? 10, input.newId)
          : chamferLines(doc, session.picks[0], session.points[0], l.id, raw, input.chamferDistanceMm ?? 5, input.chamferDistanceMm ?? 5, input.newId);
      return r.ok ? fromEdit(reset, r) : { kind: 'error', session: reset, message: r.message };
    }

    case 'offset': {
      if (session.picks.length === 0) {
        const s = pickShape(doc, raw, tolerance, undefined, canEdit);
        if (!s) return { kind: 'error', session, message: 'Click the object to offset' };
        return {
          kind: 'continue',
          session: { ...session, picks: [s.id] },
          selection: [s.id],
          prompt: `Offset ${formatNumber(input.offsetDistanceMm)} mm: click the side to offset towards`,
        };
      }
      return fromEdit(reset, offsetShape(doc, session.picks[0], input.offsetDistanceMm, raw, input.newId));
    }

    case 'mirror': {
      const shapeIds = getShapes(doc, input.selection).map((s) => s.id);
      if (shapeIds.length === 0) {
        const s = pickShape(doc, raw, tolerance, undefined, canEdit);
        if (!s) return { kind: 'error', session, message: 'Select the objects to mirror first (click them, Shift+click to add)' };
        return { kind: 'continue', session, selection: [s.id], prompt: 'Mirror: click the first point of the mirror line (Shift+click adds objects)' };
      }
      if (session.points.length === 0) {
        return { kind: 'continue', session: { ...session, points: [point] }, prompt: 'Mirror: click the second point of the mirror line' };
      }
      return fromEdit(reset, mirrorShapes(doc, shapeIds, session.points[0], point, input.mirrorKeepSource, input.newId));
    }

    case 'dim-aligned':
    case 'dim-horizontal':
    case 'dim-vertical': {
      const kind = LINEAR[session.tool];
      if (session.points.length === 0) {
        return { kind: 'continue', session: { ...session, points: [point], anchors: [anchorOf(input.snap, point)] }, prompt: 'Dimension: click the second point' };
      }
      if (session.points.length === 1) {
        if (distance(session.points[0], point) < 1e-9) return { kind: 'error', session, message: 'Second point coincides with the first – pick another point' };
        return {
          kind: 'continue',
          session: { ...session, points: [...session.points, point], anchors: [...session.anchors, anchorOf(input.snap, point)] },
          prompt: 'Dimension: click to place the dimension line',
        };
      }
      return fromDim(reset, doc, createLinearDimension(doc, input.newId(), kind, session.anchors[0], session.anchors[1], raw, input.dimStyle), 'Dimension added');
    }

    case 'dim-radius':
    case 'dim-diameter': {
      const c = pickShape(doc, raw, tolerance, ['circle', 'arc'], canSee);
      if (!c) return { kind: 'error', session, message: 'Click on a circle or an arc' };
      return fromDim(session, doc, createRadialDimension(doc, input.newId(), session.tool === 'dim-radius' ? 'radius' : 'diameter', c.id, raw, input.dimStyle), 'Dimension added');
    }

    case 'dim-angular': {
      if (session.picks.length < 2) {
        const l = pickShape(doc, raw, tolerance, ['line'], canSee);
        if (!l) return { kind: 'error', session, message: 'Click on a line' };
        if (session.picks[0] === l.id) return { kind: 'error', session, message: 'Pick a different second line' };
        const picks = [...session.picks, l.id];
        return {
          kind: 'continue',
          session: { ...session, picks },
          selection: picks,
          prompt: picks.length === 1 ? 'Angular dimension: click the second line' : 'Angular dimension: click to place the arc (choose the angle side)',
        };
      }
      return fromDim(reset, doc, createAngularDimension(doc, input.newId(), session.picks[0], session.picks[1], raw, input.dimStyle), 'Dimension added');
    }

    case 'con-coincident':
    case 'con-fixed-position': {
      const ref = pickPointRef(doc, raw, tolerance, canSee);
      if (!ref) return { kind: 'error', session, message: 'Click on a line or arc end, a midpoint, or a circle/arc centre' };
      const refs = [...(session.refs ?? []), ref];
      if (session.tool === 'con-coincident' && refs.length < 2) {
        return { kind: 'continue', session: { ...session, refs }, prompt: 'Coincident: click the second point (on another object)' };
      }
      const s = doc.shapes.find((x) => x.id === ref.shapeId)!;
      const at = shapeKeyPoints(s).find((k) => k.key === ref.key)!.point;
      const c =
        session.tool === 'con-coincident'
          ? { id: input.newId(), suppressed: false, kind: 'coincident' as const, p: refs[0], q: refs[1] }
          : { id: input.newId(), suppressed: false, kind: 'fixed-position' as const, p: ref, x: at.x, y: at.y };
      const r = addConstraint(doc, c);
      return r.ok ? { kind: 'commit', session: reset, doc: r.doc, selection: input.selection, message: r.message } : { kind: 'error', session: reset, message: r.message };
    }
  }
}

const POLY_PROMPT = 'Polyline: next point – Enter or double-click finishes, clicking the first point closes it, Backspace removes the last point';

function commitPolyline(session: ToolSession, input: ToolInput, pts: readonly Vec2[], closed: boolean): ToolStep {
  const reset = newSession(session.tool);
  if (pts.length < 2) return { kind: 'error', session, message: 'A polyline needs at least two points' };
  const p = createPolyline(input.newId(), pts, input.drawStyle, closed);
  return {
    kind: 'commit',
    session: reset,
    doc: { ...input.doc, shapes: [...input.doc.shapes, p] },
    selection: [p.id],
    message: `${closed ? 'Closed polyline' : 'Polyline'} created – ${pts.length} points, ${formatNumber(polylineLength(p))} mm long`,
  };
}

/** Enter / double-click: finish a multi-point tool. Returns null when the tool has nothing to finish. */
export function toolFinish(session: ToolSession, input: ToolInput): ToolStep | null {
  if (session.tool !== 'polyline' || session.points.length === 0) return null;
  return commitPolyline(session, input, session.points, false);
}

/** Backspace: remove the last point of a multi-point tool. */
export function toolUndoPoint(session: ToolSession): ToolSession | null {
  if (session.tool !== 'polyline' || session.points.length === 0) return null;
  return { ...session, points: session.points.slice(0, -1) };
}

export interface ToolPreview {
  readonly shapes: readonly Shape[];
  readonly dimensions: readonly Dimension[];
  /** Pieces that the click would remove (trim) – drawn as a warning. */
  readonly removedShapes: readonly Shape[];
  /** Short live readout. */
  readonly feedback: string | null;
}

const EMPTY: ToolPreview = { shapes: [], dimensions: [], removedShapes: [], feedback: null };

/** What the next click would do, for live display. Never modifies the document. */
export function toolPreview(session: ToolSession, input: ToolInput): ToolPreview {
  const { doc, raw, point, tolerance } = input;
  const previewId = () => '__preview__';
  switch (session.tool) {
    case 'text':
      return { ...EMPTY, shapes: [{ id: '__preview__', kind: 'text', position: point, text: 'Text', height: input.textHeight ?? 3.5, rotationDeg: 0, style: input.drawStyle ?? DEFAULT_TEXT_STYLE }] };
    case 'polyline': {
      const p = session.points;
      if (p.length === 0) return EMPTY;
      const closing = p.length >= 3 && distance(raw, p[0]) <= tolerance;
      const pts = closing ? p : [...p, point];
      return {
        ...EMPTY,
        shapes: [createPolyline('__preview__', pts, input.drawStyle, closing)],
        feedback: closing ? 'Click to close' : `${formatNumber(distance(p[p.length - 1], point))} mm`,
      };
    }
    case 'polygon': {
      if (session.points.length === 0) return EMPTY;
      const c = session.points[0];
      const r = distance(c, point);
      if (r < 1e-9) return EMPTY;
      const rot = (Math.atan2(point.y - c.y, point.x - c.x) * 180) / Math.PI;
      return { ...EMPTY, shapes: [createPolygon('__preview__', c, r, input.polygonSides ?? 6, rot, input.drawStyle)], feedback: `R ${formatNumber(r)} mm  ∠ ${formatNumber(rot, 2)}°` };
    }
    case 'arc': {
      const p = session.points;
      if (p.length === 1) return { ...EMPTY, shapes: [createLine('__rubber__', p[0], point)], feedback: `${formatNumber(distance(p[0], point))} mm` };
      if (p.length === 2) {
        const g = arcThroughPoints(p[0], p[1], point);
        if (!g) return { ...EMPTY, shapes: [createLine('__rubber__', p[0], point)], feedback: 'Points in a line' };
        return {
          ...EMPTY,
          shapes: [createArc('__preview__', g.c, g.r, g.startDeg, g.sweepDeg)],
          feedback: `R ${formatNumber(g.r)} mm  ∠ ${formatNumber(g.sweepDeg, 2)}°`,
        };
      }
      return EMPTY;
    }
    case 'trim': {
      const s = pickShape(doc, raw, tolerance, ['line', 'circle', 'arc', 'polyline'], input.canEdit);
      const piece = s ? trimPreviewShape(doc, s.id, raw) : null;
      if (!piece) return EMPTY;
      const len =
        piece.kind === 'line' ? distance(piece.start, piece.end) : piece.kind === 'arc' ? (piece.radius * piece.sweepDeg * Math.PI) / 180 : piece.kind === 'polyline' ? polylineLength(piece) : 0;
      return { ...EMPTY, removedShapes: [piece], feedback: `Remove ${formatNumber(len)} mm` };
    }
    case 'fillet':
    case 'chamfer': {
      if (session.picks.length === 0) return EMPTY;
      const l = pickShape(doc, raw, tolerance, ['line'], input.canEdit);
      if (!l || l.id === session.picks[0]) return EMPTY;
      const r =
        session.tool === 'fillet'
          ? filletLines(doc, session.picks[0], session.points[0], l.id, raw, input.filletRadiusMm ?? 10, () => '__preview__')
          : chamferLines(doc, session.picks[0], session.points[0], l.id, raw, input.chamferDistanceMm ?? 5, input.chamferDistanceMm ?? 5, () => '__preview__');
      if (!r.ok) return { ...EMPTY, feedback: r.message };
      const changed = r.doc.shapes.filter((x) => x.id === '__preview__' || x.id === session.picks[0] || x.id === l.id);
      return { ...EMPTY, shapes: changed, feedback: session.tool === 'fillet' ? `R ${formatNumber(input.filletRadiusMm ?? 10)} mm` : `${formatNumber(input.chamferDistanceMm ?? 5)} mm` };
    }
    case 'extend': {
      const s = pickShape(doc, raw, tolerance, ['line'], input.canEdit);
      if (!s) return EMPTY;
      const r = extendLine(doc, s.id, raw);
      if (!r.ok) return { ...EMPTY, feedback: 'No boundary' };
      const ext = r.doc.shapes.find((x) => x.id === s.id)!;
      return { ...EMPTY, shapes: [ext] };
    }
    case 'offset': {
      if (session.picks.length === 0) return EMPTY;
      const r = offsetShape(doc, session.picks[0], input.offsetDistanceMm, raw, previewId);
      return r.ok ? { ...EMPTY, shapes: [r.doc.shapes[r.doc.shapes.length - 1]], feedback: `Offset ${formatNumber(input.offsetDistanceMm)} mm` } : EMPTY;
    }
    case 'mirror': {
      if (session.points.length === 0 || distance(session.points[0], point) < 1e-9) return EMPTY;
      const a = session.points[0];
      const mirrored = getShapes(doc, input.selection).map((s) => ({ ...mirrorShape(s, a, point), id: `__preview__${s.id}` }));
      return { ...EMPTY, shapes: [createLine('__axis__', a, point), ...mirrored] };
    }
    case 'dim-aligned':
    case 'dim-horizontal':
    case 'dim-vertical': {
      if (session.points.length === 1) {
        return { ...EMPTY, shapes: [createLine('__rubber__', session.points[0], point)], feedback: `${formatNumber(distance(session.points[0], point))} mm` };
      }
      if (session.points.length === 2) {
        const r = createLinearDimension(doc, '__preview__', LINEAR[session.tool], session.anchors[0], session.anchors[1], raw, input.dimStyle);
        return r.ok ? { ...EMPTY, dimensions: [r.value] } : EMPTY;
      }
      return EMPTY;
    }
    case 'dim-radius':
    case 'dim-diameter': {
      const c = pickShape(doc, raw, tolerance, ['circle', 'arc']);
      if (!c) return EMPTY;
      const r = createRadialDimension(doc, '__preview__', session.tool === 'dim-radius' ? 'radius' : 'diameter', c.id, raw, input.dimStyle);
      return r.ok ? { ...EMPTY, dimensions: [r.value] } : EMPTY;
    }
    case 'dim-angular': {
      if (session.picks.length < 2) return EMPTY;
      const r = createAngularDimension(doc, '__preview__', session.picks[0], session.picks[1], raw, input.dimStyle);
      return r.ok ? { ...EMPTY, dimensions: [r.value] } : { ...EMPTY, feedback: r.message };
    }
    case 'con-coincident':
    case 'con-fixed-position': {
      const ref = pickPointRef(doc, raw, tolerance, input.canSee);
      return ref ? { ...EMPTY, feedback: `${ref.key === 'center' ? 'Centre' : ref.key === 'mid' ? 'Midpoint' : ref.key === 'start' ? 'Start point' : 'End point'}` } : EMPTY;
    }
  }
}
