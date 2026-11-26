import type { DrawingScale } from '../../geometry/scale';
import { formatScale } from '../../geometry/scale';
import { addShapes, allItemIds, createEmptyDocument, removeItems, replaceDimensions, replaceShapes, setDocumentScale } from '../../model/document';
import { DEFAULT_SNAP_SETTINGS, type ObjectSnapKind, type SnapSettings } from '../../model/snap';
import { constraintShapeIds, solveConstraints } from '../../model/constraints';
import { isEditable, layerOf, lockedViolation } from '../../model/layers';
import type { DisplayPrefs, ProjectSettings } from '../../storage/documentStorage';
import {
  BY_LAYER,
  DEFAULT_DIMENSION_STYLE,
  DEFAULT_LAYER_ID,
  DEFAULT_STYLE,
  type Dimension,
  type DimensionStyle,
  type DrawingDocument,
  type LayerId,
  type Shape,
  type ShapeId,
  type ShapeStyle,
} from '../../model/types';

/**
 * Editor store. `doc` is the single source of truth for all geometry.
 * The reducer is pure and UI-independent (tested in tests/editorReducer.test.ts).
 */
export type DimensionToolId = 'dim-aligned' | 'dim-horizontal' | 'dim-vertical' | 'dim-angular' | 'dim-radius' | 'dim-diameter';
export type ModifyToolId = 'trim' | 'extend' | 'offset' | 'mirror' | 'fillet' | 'chamfer';
export type ConstraintToolId = 'con-coincident' | 'con-fixed-position';
export type ToolId = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'freehand' | 'polyline' | 'polygon' | 'text' | ModifyToolId | DimensionToolId | ConstraintToolId;

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  freehand: 'Freehand',
  polyline: 'Polyline',
  polygon: 'Polygon',
  text: 'Text',
  trim: 'Trim',
  extend: 'Extend',
  offset: 'Offset',
  mirror: 'Mirror',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  'dim-aligned': 'Aligned dimension',
  'dim-horizontal': 'Horizontal dimension',
  'dim-vertical': 'Vertical dimension',
  'dim-angular': 'Angular dimension',
  'dim-radius': 'Radius dimension',
  'dim-diameter': 'Diameter dimension',
  'con-coincident': 'Coincident constraint',
  'con-fixed-position': 'Fixed-position constraint',
};

/** First prompt shown in the status bar when a tool becomes active. */
export const TOOL_PROMPTS: Record<ToolId, string> = {
  select: 'Select: click an object, drag a window, or drag grips to edit',
  line: 'Line: drag, or click the first point (Shift = 15° steps)',
  rect: 'Rectangle: drag, or click the first corner (Shift = square)',
  circle: 'Circle: drag, or click the centre',
  arc: 'Arc: click the start point, then a point on the arc, then the end point',
  freehand: 'Freehand: drag to draw',
  polyline: 'Polyline: click the first point',
  polygon: 'Polygon: click the centre (number of sides in Properties)',
  text: 'Text: click where the text starts (bottom-left of the first line)',
  trim: 'Trim: click the part of a line, circle, arc or polyline to remove',
  extend: 'Extend: click a line near the end to extend',
  offset: 'Offset: click the object to offset',
  mirror: 'Mirror: select objects (Shift+click), then click two points on the mirror line',
  fillet: 'Fillet: click the first line on the side to keep',
  chamfer: 'Chamfer: click the first line on the side to keep',
  'dim-aligned': 'Aligned dimension: click the first point',
  'dim-horizontal': 'Horizontal dimension: click the first point',
  'dim-vertical': 'Vertical dimension: click the first point',
  'dim-angular': 'Angular dimension: click the first line',
  'dim-radius': 'Radius dimension: click a circle',
  'dim-diameter': 'Diameter dimension: click a circle',
  'con-coincident': 'Coincident: click the first point (line end/midpoint or circle centre)',
  'con-fixed-position': 'Fixed position: click a line end/midpoint or circle centre to pin it',
};

export const isDimensionTool = (t: ToolId): t is DimensionToolId => t.startsWith('dim-');

export interface ViewSettings {
  readonly showGrid: boolean;
  /** Grid snap on/off. */
  readonly snapEnabled: boolean;
  /** Grid snap increment in drawing (world) millimetres. */
  readonly snapStepMm: number;
  /** Visible grid spacing in drawing millimetres. */
  readonly gridSpacingMm: number;
  /** Object snap master switch. */
  readonly objectSnap: boolean;
  readonly osnap: Readonly<Record<ObjectSnapKind, boolean>>;
}

export const snapSettingsOf = (v: ViewSettings): SnapSettings => ({
  objectSnap: v.objectSnap,
  kinds: v.osnap,
  gridSnap: v.snapEnabled,
  gridStepMm: v.snapStepMm,
});

export interface EditorState {
  readonly doc: DrawingDocument;
  /** Document as last saved/loaded; dirty = doc !== savedDoc. */
  readonly savedDoc: DrawingDocument;
  readonly selection: readonly ShapeId[];
  readonly tool: ToolId;
  readonly past: readonly DrawingDocument[];
  readonly future: readonly DrawingDocument[];
  /** Snapshot taken at the start of an interactive edit (drag). */
  readonly editBase: DrawingDocument | null;
  readonly filePath: string | null;
  /** Format version of the file as opened (< current ⇒ saving will upgrade it). */
  readonly sourceVersion: number | null;
  /** Layer that receives new objects. */
  readonly activeLayerId: LayerId;
  /** Opened from an autosave recovery copy: unsaved until the user saves it. */
  readonly recovered: boolean;
  readonly fileName: string;
  readonly drawStyle: ShapeStyle;
  readonly view: ViewSettings;
  /** Style applied to new dimensions. */
  readonly dimStyle: DimensionStyle;
  /** Offset tool distance (drawing mm). */
  readonly offsetDistanceMm: number;
  /** Mirror tool: keep the source objects (copy) or replace them. */
  readonly mirrorKeepSource: boolean;
  /** Fillet tool radius and chamfer tool distance (drawing mm). */
  readonly filletRadiusMm: number;
  readonly chamferDistanceMm: number;
  /** Polygon tool: number of sides. */
  readonly polygonSides: number;
  /** Text tool: letter height of new text, PAPER mm. */
  readonly textHeightMm: number;
  readonly message: string;
}

export const HISTORY_LIMIT = 200;

export function createInitialState(): EditorState {
  const doc = createEmptyDocument();
  return {
    doc,
    savedDoc: doc,
    selection: [],
    tool: 'select',
    past: [],
    future: [],
    editBase: null,
    filePath: null,
    sourceVersion: null,
    activeLayerId: DEFAULT_LAYER_ID,
    recovered: false,
    fileName: 'Untitled.a3d',
    drawStyle: { ...DEFAULT_STYLE, stroke: BY_LAYER },
    view: {
      showGrid: true,
      snapEnabled: true,
      snapStepMm: 1,
      gridSpacingMm: 10,
      objectSnap: DEFAULT_SNAP_SETTINGS.objectSnap,
      osnap: DEFAULT_SNAP_SETTINGS.kinds,
    },
    dimStyle: DEFAULT_DIMENSION_STYLE,
    offsetDistanceMm: 10,
    mirrorKeepSource: true,
    filletRadiusMm: 10,
    chamferDistanceMm: 5,
    polygonSides: 6,
    textHeightMm: 3.5,
    message: 'Ready',
  };
}

export type EditorAction =
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setSelection'; ids: readonly ShapeId[] }
  | { type: 'toggleSelection'; id: ShapeId }
  | { type: 'selectAll' }
  | { type: 'addShapes'; shapes: readonly Shape[]; message?: string }
  | { type: 'updateShapes'; shapes: readonly Shape[]; message?: string }
  | { type: 'updateDimensions'; dimensions: readonly Dimension[]; message?: string }
  /** Commit a complete new document (trim/extend/offset/mirror/dimensions) as ONE undo step. */
  | { type: 'commitDocument'; doc: DrawingDocument; selection?: readonly ShapeId[]; message: string }
  | { type: 'deleteSelection' }
  | { type: 'beginEdit' }
  | { type: 'previewShapes'; shapes: readonly Shape[] }
  /** During an interactive edit: replace the whole document (shapes + dimensions). */
  | { type: 'previewDocument'; doc: DrawingDocument }
  | { type: 'endEdit'; message?: string }
  | { type: 'cancelEdit' }
  | { type: 'setScale'; scale: DrawingScale }
  | { type: 'setDrawStyle'; style: Partial<ShapeStyle> }
  | { type: 'setView'; view: Partial<ViewSettings> }
  | { type: 'setDimStyle'; style: Partial<DimensionStyle> }
  | { type: 'setOffsetDistance'; mm: number }
  | { type: 'setMirrorKeepSource'; keep: boolean }
  | { type: 'setFilletRadius'; mm: number }
  | { type: 'setPolygonSides'; sides: number }
  | { type: 'setTextHeight'; mm: number }
  | { type: 'setChamferDistance'; mm: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'newDocument' }
  | {
      type: 'loadDocument';
      doc: DrawingDocument;
      path: string | null;
      name: string;
      settings?: ProjectSettings;
      sourceVersion?: number;
      message?: string;
      /** Recovered from autosave: open as MODIFIED (not saved). */
      recovered?: boolean;
    }
  | { type: 'setActiveLayer'; id: LayerId }
  | { type: 'markSaved'; path: string | null; name: string }
  | { type: 'setMessage'; message: string };

export const isDirty = (s: EditorState): boolean => s.doc !== s.savedDoc;

/** Shapes whose geometry object changed between two documents. */
function changedShapeIds(base: DrawingDocument, next: DrawingDocument): Set<ShapeId> {
  const before = new Map(base.shapes.map((x) => [x.id, x]));
  return new Set(next.shapes.filter((x) => before.get(x.id) !== x).map((x) => x.id));
}

/**
 * After a geometry edit, re-satisfy the driving constraints that involve the edited
 * objects (the edited objects are preferred to stay where the user put them).
 * If that is impossible the user's edit is kept as-is and the constraints are reported
 * as not satisfied – geometry is never silently distorted to fit.
 */
export function enforceConstraints(base: DrawingDocument, next: DrawingDocument): { doc: DrawingDocument; note: string | null } {
  const changed = changedShapeIds(base, next);
  if (changed.size === 0) return { doc: next, note: null };
  const involved = next.constraints.some((c) => !c.suppressed && constraintShapeIds(c).some((id) => changed.has(id)));
  if (!involved) return { doc: next, note: null };
  const r = solveConstraints(next, { preferred: changed });
  if (!r.ok) return { doc: next, note: `⚠ ${r.unsatisfied.length} constraint${r.unsatisfied.length === 1 ? '' : 's'} not satisfied – ${r.reason ?? 'conflict'}` };
  const others = r.moved.filter((id) => !changed.has(id)).length;
  const adjusted = r.moved.some((id) => changed.has(id));
  return {
    doc: r.doc,
    note: others || adjusted ? `constraints applied${others ? ` (${others} other object${others === 1 ? '' : 's'} adjusted)` : ''}` : null,
  };
}

/** New objects without a layer are placed on the active layer. */
function stampLayer(prev: DrawingDocument, next: DrawingDocument, layerId: LayerId): DrawingDocument {
  const known = new Set(allItemIds(prev));
  const fix = <T extends { id: string; layerId?: string }>(x: T): T => (known.has(x.id) || x.layerId ? x : { ...x, layerId });
  const shapes = next.shapes.map(fix);
  const dimensions = next.dimensions.map(fix);
  const same = shapes.every((x, i) => x === next.shapes[i]) && dimensions.every((x, i) => x === next.dimensions[i]);
  return same ? next : { ...next, shapes, dimensions };
}

/** Reason new objects cannot be created on the active layer (null = fine). */
function activeLayerProblem(state: EditorState): string | null {
  const l = layerOf(state.doc, { layerId: state.activeLayerId });
  if (l.locked) return `Active layer "${l.name}" is locked – unlock it or choose another layer`;
  if (!l.visible) return `Active layer "${l.name}" is hidden – show it or choose another layer`;
  return null;
}

/**
 * Commit a new document as ONE undo step. Guards: objects on locked layers can never be
 * changed; new objects go to the active layer (refused if it is locked/hidden); driving
 * constraints are re-applied after geometry edits.
 */
function commit(state: EditorState, proposed: DrawingDocument, extra: Partial<EditorState> = {}): EditorState {
  if (proposed === state.doc) return { ...state, ...extra };
  const known = new Set(allItemIds(state.doc));
  const createsUnlayered = [...proposed.shapes, ...proposed.dimensions].some((x) => !known.has(x.id) && !x.layerId);
  if (createsUnlayered) {
    const problem = activeLayerProblem(state);
    if (problem) return { ...state, message: `⚠ ${problem}` };
  }
  const stamped = stampLayer(state.doc, proposed, state.activeLayerId);
  const violation = lockedViolation(state.doc, stamped);
  if (violation) return { ...state, message: `⚠ ${violation}` };
  const { doc, note } = enforceConstraints(state.doc, stamped);
  const message = extra.message ?? state.message;
  return {
    ...state,
    ...extra,
    message: note ? `${message} – ${note}` : message,
    doc,
    selection: keepExisting(doc, extra.selection ?? state.selection),
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** Selection may only contain items that exist and are editable (visible, unlocked layer). */
const keepExisting = (doc: DrawingDocument, ids: readonly ShapeId[]) => {
  const ok = new Set([
    ...doc.shapes.filter((x) => isEditable(doc, x)).map((x) => x.id),
    ...doc.dimensions.filter((x) => isEditable(doc, x)).map((x) => x.id),
    ...doc.constraints.map((c) => c.id),
  ]);
  return ids.filter((id) => ok.has(id));
};

export const displayPrefsOf = (v: ViewSettings): DisplayPrefs => ({
  showGrid: v.showGrid,
  gridSpacingMm: v.gridSpacingMm,
  gridSnap: v.snapEnabled,
  gridSnapStepMm: v.snapStepMm,
  objectSnap: v.objectSnap,
  osnap: v.osnap,
});

export const projectSettingsOf = (s: EditorState): ProjectSettings => ({ activeLayerId: s.activeLayerId, display: displayPrefsOf(s.view) });

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, tool: action.tool, message: TOOL_PROMPTS[action.tool] };
    case 'setSelection':
      return { ...state, selection: keepExisting(state.doc, action.ids) };
    case 'toggleSelection':
      return {
        ...state,
        selection: state.selection.includes(action.id)
          ? state.selection.filter((id) => id !== action.id)
          : keepExisting(state.doc, [...state.selection, action.id]),
      };
    case 'selectAll':
      return {
        ...state,
        selection: [...state.doc.shapes, ...state.doc.dimensions].filter((x) => isEditable(state.doc, x)).map((x) => x.id),
      };
    case 'setActiveLayer': {
      const l = state.doc.layers.find((x) => x.id === action.id);
      return l ? { ...state, activeLayerId: l.id, message: `Active layer: ${l.name}${l.locked ? ' (locked)' : ''}${!l.visible ? ' (hidden)' : ''}` } : state;
    }
    case 'addShapes':
      if (action.shapes.length === 0) return state;
      return commit(state, addShapes(state.doc, action.shapes), {
        selection: action.shapes.map((s) => s.id),
        message: action.message ?? state.message,
      });
    case 'updateShapes':
      return commit(state, replaceShapes(state.doc, action.shapes), { message: action.message ?? state.message });
    case 'updateDimensions':
      return commit(state, replaceDimensions(state.doc, action.dimensions), { message: action.message ?? state.message });
    case 'commitDocument':
      return commit(state, action.doc, {
        selection: keepExisting(action.doc, action.selection ?? state.selection),
        message: action.message,
      });
    case 'deleteSelection': {
      if (state.selection.length === 0) return state;
      const res = removeItems(state.doc, state.selection);
      const n = res.removedShapes + res.removedDimensions - res.dependentDimensions + res.removedConstraints - res.dependentConstraints;
      const deps = [
        res.dependentDimensions ? `${res.dependentDimensions} dependent dimension${res.dependentDimensions === 1 ? '' : 's'}` : '',
        res.dependentConstraints ? `${res.dependentConstraints} dependent constraint${res.dependentConstraints === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      const extra = deps.length ? ` and ${deps.join(' and ')}` : '';
      return commit(state, res.doc, {
        selection: [],
        message: `Deleted ${n} object${n === 1 ? '' : 's'}${extra}`,
      });
    }
    case 'beginEdit':
      return { ...state, editBase: state.doc };
    case 'previewShapes':
    case 'previewDocument': {
      const base = state.editBase;
      if (!base) return state;
      // Each preview starts from the state before the drag, so constraint solving never accumulates.
      const proposed = action.type === 'previewShapes' ? replaceShapes(base, action.shapes) : action.doc;
      if (lockedViolation(base, proposed)) return state;
      return { ...state, doc: enforceConstraints(base, proposed).doc };
    }
    case 'endEdit': {
      const base = state.editBase;
      if (!base) return state;
      if (base === state.doc) return { ...state, editBase: null };
      const violation = lockedViolation(base, state.doc);
      if (violation) return { ...state, doc: base, editBase: null, message: `⚠ ${violation}` };
      return {
        ...state,
        editBase: null,
        past: [...state.past, base].slice(-HISTORY_LIMIT),
        future: [],
        message: action.message ?? state.message,
      };
    }
    case 'cancelEdit':
      return state.editBase ? { ...state, doc: state.editBase, editBase: null } : state;
    case 'setScale':
      return commit(state, setDocumentScale(state.doc, action.scale), {
        message: `Drawing scale set to ${formatScale(action.scale)} – object geometry unchanged`,
      });
    case 'setDrawStyle':
      return { ...state, drawStyle: { ...state.drawStyle, ...action.style } };
    case 'setView':
      return { ...state, view: { ...state.view, ...action.view } };
    case 'setDimStyle':
      return { ...state, dimStyle: { ...state.dimStyle, ...action.style } };
    case 'setOffsetDistance':
      return action.mm > 0 && Number.isFinite(action.mm) ? { ...state, offsetDistanceMm: action.mm } : state;
    case 'setMirrorKeepSource':
      return { ...state, mirrorKeepSource: action.keep };
    case 'setPolygonSides':
      return Number.isInteger(action.sides) && action.sides >= 3 && action.sides <= 64 ? { ...state, polygonSides: action.sides } : state;
    case 'setTextHeight':
      return action.mm > 0 && action.mm <= 100 ? { ...state, textHeightMm: action.mm } : state;
    case 'setFilletRadius':
      return action.mm >= 0 && Number.isFinite(action.mm) ? { ...state, filletRadiusMm: action.mm } : state;
    case 'setChamferDistance':
      return action.mm >= 0 && Number.isFinite(action.mm) ? { ...state, chamferDistanceMm: action.mm } : state;
    case 'undo': {
      if (state.past.length === 0) return { ...state, message: 'Nothing to undo' };
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        doc: prev,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
        selection: keepExisting(prev, state.selection),
        message: 'Undo',
      };
    }
    case 'redo': {
      if (state.future.length === 0) return { ...state, message: 'Nothing to redo' };
      const next = state.future[0];
      return {
        ...state,
        doc: next,
        past: [...state.past, state.doc],
        future: state.future.slice(1),
        selection: keepExisting(next, state.selection),
        message: 'Redo',
      };
    }
    case 'newDocument': {
      const init = createInitialState();
      return {
        ...init,
        view: state.view,
        drawStyle: state.drawStyle,
        dimStyle: state.dimStyle,
        offsetDistanceMm: state.offsetDistanceMm,
        mirrorKeepSource: state.mirrorKeepSource,
        filletRadiusMm: state.filletRadiusMm,
        chamferDistanceMm: state.chamferDistanceMm,
        polygonSides: state.polygonSides,
        textHeightMm: state.textHeightMm,
        message: 'New drawing',
      };
    }
    case 'loadDocument': {
      const set = action.settings;
      const view = set
        ? {
            ...state.view,
            showGrid: set.display.showGrid,
            gridSpacingMm: set.display.gridSpacingMm,
            snapEnabled: set.display.gridSnap,
            snapStepMm: set.display.gridSnapStepMm,
            objectSnap: set.display.objectSnap,
            osnap: set.display.osnap,
          }
        : state.view;
      return {
        ...state,
        view,
        activeLayerId: set && action.doc.layers.some((l) => l.id === set.activeLayerId) ? set.activeLayerId : action.doc.layers[0].id,
        sourceVersion: action.sourceVersion ?? null,
        recovered: action.recovered ?? false,
        doc: action.doc,
        // A recovered drawing has never been saved in this form: keep it marked modified.
        savedDoc: action.recovered ? createEmptyDocument() : action.doc,
        selection: [],
        past: [],
        future: [],
        editBase: null,
        filePath: action.path,
        fileName: action.name,
        message: action.message ?? `Opened ${action.name}`,
      };
    }
    case 'markSaved':
      return { ...state, savedDoc: state.doc, filePath: action.path, fileName: action.name, sourceVersion: null, recovered: false, message: `Saved ${action.name}` };
    case 'setMessage':
      return { ...state, message: action.message };
  }
}
