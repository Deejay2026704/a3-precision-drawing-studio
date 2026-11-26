import type { DrawingScale } from '../../geometry/scale';
import { formatScale } from '../../geometry/scale';
import { addShapes, allItemIds, createEmptyDocument, removeItems, replaceDimensions, replaceShapes, setDocumentScale } from '../../model/document';
import { DEFAULT_SNAP_SETTINGS, type ObjectSnapKind, type SnapSettings } from '../../model/snap';
import {
  DEFAULT_DIMENSION_STYLE,
  DEFAULT_STYLE,
  type Dimension,
  type DimensionStyle,
  type DrawingDocument,
  type Shape,
  type ShapeId,
  type ShapeStyle,
} from '../../model/types';

/**
 * Editor store. `doc` is the single source of truth for all geometry.
 * The reducer is pure and UI-independent (tested in tests/editorReducer.test.ts).
 */
export type DimensionToolId = 'dim-aligned' | 'dim-horizontal' | 'dim-vertical' | 'dim-angular' | 'dim-radius' | 'dim-diameter';
export type ModifyToolId = 'trim' | 'extend' | 'offset' | 'mirror';
export type ToolId = 'select' | 'line' | 'rect' | 'circle' | 'freehand' | ModifyToolId | DimensionToolId;

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  freehand: 'Freehand',
  trim: 'Trim',
  extend: 'Extend',
  offset: 'Offset',
  mirror: 'Mirror',
  'dim-aligned': 'Aligned dimension',
  'dim-horizontal': 'Horizontal dimension',
  'dim-vertical': 'Vertical dimension',
  'dim-angular': 'Angular dimension',
  'dim-radius': 'Radius dimension',
  'dim-diameter': 'Diameter dimension',
};

/** First prompt shown in the status bar when a tool becomes active. */
export const TOOL_PROMPTS: Record<ToolId, string> = {
  select: 'Select: click an object, drag a window, or drag grips to edit',
  line: 'Line: drag, or click the first point (Shift = 15° steps)',
  rect: 'Rectangle: drag, or click the first corner (Shift = square)',
  circle: 'Circle: drag, or click the centre',
  freehand: 'Freehand: drag to draw',
  trim: 'Trim: click the part of a line to remove',
  extend: 'Extend: click a line near the end to extend',
  offset: 'Offset: click the object to offset',
  mirror: 'Mirror: select objects (Shift+click), then click two points on the mirror line',
  'dim-aligned': 'Aligned dimension: click the first point',
  'dim-horizontal': 'Horizontal dimension: click the first point',
  'dim-vertical': 'Vertical dimension: click the first point',
  'dim-angular': 'Angular dimension: click the first line',
  'dim-radius': 'Radius dimension: click a circle',
  'dim-diameter': 'Diameter dimension: click a circle',
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
  readonly fileName: string;
  readonly drawStyle: ShapeStyle;
  readonly view: ViewSettings;
  /** Style applied to new dimensions. */
  readonly dimStyle: DimensionStyle;
  /** Offset tool distance (drawing mm). */
  readonly offsetDistanceMm: number;
  /** Mirror tool: keep the source objects (copy) or replace them. */
  readonly mirrorKeepSource: boolean;
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
    fileName: 'Untitled.a3d',
    drawStyle: DEFAULT_STYLE,
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
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'newDocument' }
  | { type: 'loadDocument'; doc: DrawingDocument; path: string | null; name: string }
  | { type: 'markSaved'; path: string | null; name: string }
  | { type: 'setMessage'; message: string };

export const isDirty = (s: EditorState): boolean => s.doc !== s.savedDoc;

/** Commit a new document, pushing the previous one onto the undo stack. */
function commit(state: EditorState, doc: DrawingDocument, extra: Partial<EditorState> = {}): EditorState {
  if (doc === state.doc) return { ...state, ...extra };
  return {
    ...state,
    ...extra,
    doc,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
  };
}

const keepExisting = (doc: DrawingDocument, ids: readonly ShapeId[]) => {
  const all = new Set(allItemIds(doc));
  return ids.filter((id) => all.has(id));
};

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
      return { ...state, selection: allItemIds(state.doc) };
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
      const n = res.removedShapes + res.removedDimensions - res.dependentDimensions;
      const extra = res.dependentDimensions ? ` and ${res.dependentDimensions} dependent dimension${res.dependentDimensions === 1 ? '' : 's'}` : '';
      return commit(state, res.doc, {
        selection: [],
        message: `Deleted ${n} object${n === 1 ? '' : 's'}${extra}`,
      });
    }
    case 'beginEdit':
      return { ...state, editBase: state.doc };
    case 'previewShapes':
      if (!state.editBase) return state;
      return { ...state, doc: replaceShapes(state.doc, action.shapes) };
    case 'previewDocument':
      return state.editBase ? { ...state, doc: action.doc } : state;
    case 'endEdit': {
      const base = state.editBase;
      if (!base) return state;
      if (base === state.doc) return { ...state, editBase: null };
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
        message: 'New drawing',
      };
    }
    case 'loadDocument':
      return {
        ...state,
        doc: action.doc,
        savedDoc: action.doc,
        selection: [],
        past: [],
        future: [],
        editBase: null,
        filePath: action.path,
        fileName: action.name,
        message: `Opened ${action.name}`,
      };
    case 'markSaved':
      return { ...state, savedDoc: state.doc, filePath: action.path, fileName: action.name, message: `Saved ${action.name}` };
    case 'setMessage':
      return { ...state, message: action.message };
  }
}
