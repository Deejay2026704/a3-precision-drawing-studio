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
import { extendLine, mirrorShape, mirrorShapes, offsetShape, trimLine, trimPreview, type EditResult } from '../../model/modify';
import type { SnapResult } from '../../model/snap';
import { createLine } from '../../model/shapes';
import type { DimAnchor, Dimension, DimensionStyle, DrawingDocument, Shape, ShapeId, ShapeKind } from '../../model/types';
import type { DimensionToolId, ModifyToolId } from '../state/editorReducer';

/**
 * Click-driven tools (modify + dimension) as a pure state machine.
 * The canvas feeds it snapped clicks; it returns either "continue" (with a prompt),
 * a document to commit (one undo step), or a refusal message. No DOM, no React.
 */
export type SessionTool = ModifyToolId | DimensionToolId;

export interface ToolSession {
  readonly tool: SessionTool;
  readonly points: readonly Vec2[];
  readonly anchors: readonly DimAnchor[];
  readonly picks: readonly ShapeId[];
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
}

export type ToolStep =
  | { readonly kind: 'continue'; readonly session: ToolSession; readonly prompt: string; readonly selection?: readonly ShapeId[] }
  | { readonly kind: 'commit'; readonly session: ToolSession; readonly doc: DrawingDocument; readonly selection: readonly ShapeId[]; readonly message: string }
  | { readonly kind: 'error'; readonly session: ToolSession; readonly message: string };

/** Topmost shape under the cursor, optionally restricted to some kinds. */
export function pickShape(doc: DrawingDocument, p: Vec2, tolerance: number, kinds?: readonly ShapeKind[]): Shape | null {
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const s = doc.shapes[i];
    if (kinds && !kinds.includes(s.kind)) continue;
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

export function toolClick(session: ToolSession, input: ToolInput): ToolStep {
  const { doc, raw, point, tolerance } = input;
  const reset = newSession(session.tool);

  switch (session.tool) {
    case 'trim':
    case 'extend': {
      const s = pickShape(doc, raw, tolerance);
      if (!s) return { kind: 'error', session, message: `Click on a line to ${session.tool}` };
      return fromEdit(session, session.tool === 'trim' ? trimLine(doc, s.id, raw, input.newId) : extendLine(doc, s.id, raw));
    }

    case 'offset': {
      if (session.picks.length === 0) {
        const s = pickShape(doc, raw, tolerance);
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
        const s = pickShape(doc, raw, tolerance);
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
      const c = pickShape(doc, raw, tolerance, ['circle']);
      if (!c) return { kind: 'error', session, message: 'Click on a circle' };
      return fromDim(session, doc, createRadialDimension(doc, input.newId(), session.tool === 'dim-radius' ? 'radius' : 'diameter', c.id, raw, input.dimStyle), 'Dimension added');
    }

    case 'dim-angular': {
      if (session.picks.length < 2) {
        const l = pickShape(doc, raw, tolerance, ['line']);
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
  }
}

export interface ToolPreview {
  readonly shapes: readonly Shape[];
  readonly dimensions: readonly Dimension[];
  /** Segments that the click would remove (trim) – drawn as a warning. */
  readonly removed: readonly (readonly [Vec2, Vec2])[];
  /** Short live readout. */
  readonly feedback: string | null;
}

const EMPTY: ToolPreview = { shapes: [], dimensions: [], removed: [], feedback: null };

/** What the next click would do, for live display. Never modifies the document. */
export function toolPreview(session: ToolSession, input: ToolInput): ToolPreview {
  const { doc, raw, point, tolerance } = input;
  const previewId = () => '__preview__';
  switch (session.tool) {
    case 'trim': {
      const s = pickShape(doc, raw, tolerance, ['line']);
      const seg = s ? trimPreview(doc, s.id, raw) : null;
      return seg ? { ...EMPTY, removed: [seg], feedback: `Remove ${formatNumber(distance(seg[0], seg[1]))} mm` } : EMPTY;
    }
    case 'extend': {
      const s = pickShape(doc, raw, tolerance, ['line']);
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
      const c = pickShape(doc, raw, tolerance, ['circle']);
      if (!c) return EMPTY;
      const r = createRadialDimension(doc, '__preview__', session.tool === 'dim-radius' ? 'radius' : 'diameter', c.id, raw, input.dimStyle);
      return r.ok ? { ...EMPTY, dimensions: [r.value] } : EMPTY;
    }
    case 'dim-angular': {
      if (session.picks.length < 2) return EMPTY;
      const r = createAngularDimension(doc, '__preview__', session.picks[0], session.picks[1], raw, input.dimStyle);
      return r.ok ? { ...EMPTY, dimensions: [r.value] } : { ...EMPTY, feedback: r.message };
    }
  }
}
