import type { DrawingScale } from '../../geometry/scale';
import { formatScale } from '../../geometry/scale';
import { addShapes, createEmptyDocument, removeShapes, replaceShapes, setDocumentScale } from '../../model/document';
import { DEFAULT_STYLE, type DrawingDocument, type Shape, type ShapeId, type ShapeStyle } from '../../model/types';

/**
 * Editor store. `doc` is the single source of truth for all geometry.
 * The reducer is pure and UI-independent (tested in tests/editorReducer.test.ts).
 */
export type ToolId = 'select' | 'line' | 'rect' | 'circle' | 'freehand';

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Select',
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  freehand: 'Freehand',
};

export interface ViewSettings {
  readonly showGrid: boolean;
  readonly snapEnabled: boolean;
  /** Snap increment in drawing (world) millimetres. */
  readonly snapStepMm: number;
}

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
    view: { showGrid: true, snapEnabled: true, snapStepMm: 1 },
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
  | { type: 'deleteSelection' }
  | { type: 'beginEdit' }
  | { type: 'previewShapes'; shapes: readonly Shape[] }
  | { type: 'endEdit'; message?: string }
  | { type: 'cancelEdit' }
  | { type: 'setScale'; scale: DrawingScale }
  | { type: 'setDrawStyle'; style: Partial<ShapeStyle> }
  | { type: 'setView'; view: Partial<ViewSettings> }
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
  const all = new Set(doc.shapes.map((s) => s.id));
  return ids.filter((id) => all.has(id));
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, tool: action.tool, message: `${TOOL_LABELS[action.tool]} tool` };
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
      return { ...state, selection: state.doc.shapes.map((s) => s.id) };
    case 'addShapes':
      if (action.shapes.length === 0) return state;
      return commit(state, addShapes(state.doc, action.shapes), {
        selection: action.shapes.map((s) => s.id),
        message: action.message ?? state.message,
      });
    case 'updateShapes':
      return commit(state, replaceShapes(state.doc, action.shapes), { message: action.message ?? state.message });
    case 'deleteSelection': {
      if (state.selection.length === 0) return state;
      const n = state.selection.length;
      return commit(state, removeShapes(state.doc, state.selection), {
        selection: [],
        message: `Deleted ${n} object${n === 1 ? '' : 's'}`,
      });
    }
    case 'beginEdit':
      return { ...state, editBase: state.doc };
    case 'previewShapes':
      if (!state.editBase) return state;
      return { ...state, doc: replaceShapes(state.doc, action.shapes) };
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
      return { ...init, view: state.view, drawStyle: state.drawStyle, message: 'New drawing' };
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
