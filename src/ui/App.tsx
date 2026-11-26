import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { pageLengthToWorld } from '../geometry/scale';
import { centredAtZoom, fitPage, zoomAt, type Viewport } from '../geometry/viewport';
import { vec, type Vec2 } from '../geometry/vec';
import { duplicateShapes, getShapes } from '../model/document';
import { createIdGenerator } from '../model/ids';
import { moveShape } from '../model/operations';
import { DocumentFormatError, FILE_EXTENSION, parseDocument, serializeDocument } from '../storage/documentStorage';
import { baseName, getFileService } from '../storage/fileService';
import { DrawingCanvas } from './DrawingCanvas';
import { FileMenu, type FileCommands } from './FileMenu';
import { PropertiesPanel } from './PropertiesPanel';
import { Ribbon, type EditCommands, type RibbonTab, type ViewCommands } from './Ribbon';
import { StatusBar } from './StatusBar';
import { createInitialState, editorReducer, isDirty, type ToolId } from './state/editorReducer';

export const APP_TITLE = 'A3 Precision Drawing Studio';
const DUPLICATE_OFFSET_PAPER_MM = 10;

const TOOL_KEYS: Record<string, ToolId> = { v: 'select', l: 'line', r: 'rect', c: 'circle', f: 'freehand' };

export function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);
  const [tab, setTab] = useState<RibbonTab>('home');
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, originX: 0, originY: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const canvasSize = useRef({ width: 0, height: 0 });
  const fitted = useRef(false);
  const newId = useMemo(() => createIdGenerator(), []);
  const files = useMemo(() => getFileService(), []);
  const stateRef = useRef(state);
  stateRef.current = state;
  if (import.meta.env.DEV) (window as unknown as { __a3State?: () => unknown }).__a3State = () => stateRef.current;

  const dirty = isDirty(state);

  // ---- window title + dirty flag for the native close prompt ----
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${state.fileName} – ${APP_TITLE}`;
    window.a3Studio?.setDirty(dirty);
  }, [dirty, state.fileName]);

  // ---- view commands ----
  const fit = useCallback(() => {
    const { width, height } = canvasSize.current;
    if (width > 0 && height > 0) setViewport(fitPage(stateRef.current.doc.page, width, height));
  }, []);

  const onResize = useCallback(
    (width: number, height: number) => {
      canvasSize.current = { width, height };
      if (!fitted.current && width > 0 && height > 0) {
        fitted.current = true;
        fit();
      }
    },
    [fit],
  );

  const centre = () => vec(canvasSize.current.width / 2, canvasSize.current.height / 2);
  const view: ViewCommands = {
    zoomIn: () => setViewport((vp) => zoomAt(vp, vp.zoom * 1.25, centre())),
    zoomOut: () => setViewport((vp) => zoomAt(vp, vp.zoom / 1.25, centre())),
    zoomTo: (z) => setViewport(centredAtZoom(state.doc.page, canvasSize.current.width, canvasSize.current.height, z)),
    fitPage: fit,
  };

  // ---- edit commands ----
  const edit: EditCommands = {
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    deleteSelection: () => dispatch({ type: 'deleteSelection' }),
    selectAll: () => dispatch({ type: 'selectAll' }),
    duplicate: () => {
      const s = stateRef.current;
      if (s.selection.length === 0) return;
      const off = pageLengthToWorld(DUPLICATE_OFFSET_PAPER_MM, s.doc.scale);
      const { doc, newIds } = duplicateShapes(s.doc, s.selection, newId, vec(off, -off));
      dispatch({
        type: 'addShapes',
        shapes: getShapes(doc, newIds),
        message: `Duplicated ${newIds.length} object${newIds.length === 1 ? '' : 's'}`,
      });
    },
  };

  // ---- file commands ----
  const confirmDiscard = () => !isDirty(stateRef.current) || window.confirm('The drawing has unsaved changes. Discard them?');

  const saveAs = async () => {
    const s = stateRef.current;
    try {
      const name = s.fileName.endsWith(`.${FILE_EXTENSION}`) ? s.fileName : `${s.fileName}.${FILE_EXTENSION}`;
      const path = await files.saveAs(serializeDocument(s.doc), name);
      if (path) dispatch({ type: 'markSaved', path, name: baseName(path) });
    } catch (err) {
      dispatch({ type: 'setMessage', message: `Save failed: ${(err as Error).message}` });
    }
  };

  const fileCommands: FileCommands = {
    newDrawing: () => {
      if (!confirmDiscard()) return;
      dispatch({ type: 'newDocument' });
      fit();
    },
    open: async () => {
      if (!confirmDiscard()) return;
      try {
        const res = await files.open();
        if (!res) return;
        const doc = parseDocument(res.content);
        dispatch({ type: 'loadDocument', doc, path: res.path, name: baseName(res.path) });
        fit();
      } catch (err) {
        const msg = err instanceof DocumentFormatError ? err.message : (err as Error).message;
        dispatch({ type: 'setMessage', message: `Could not open file: ${msg}` });
        window.alert(`Could not open file:\n${msg}`);
      }
    },
    save: async () => {
      const s = stateRef.current;
      if (!s.filePath || !files.canSaveInPlace) return saveAs();
      try {
        const path = await files.save(s.filePath, serializeDocument(s.doc));
        dispatch({ type: 'markSaved', path, name: baseName(path) });
      } catch (err) {
        dispatch({ type: 'setMessage', message: `Save failed: ${(err as Error).message}` });
      }
    },
    saveAs,
    exit: () => (window.a3Studio ? window.a3Studio.quit() : window.close()),
  };

  // ---- keyboard shortcuts ----
  const handlersRef = useRef({ fileCommands, edit });
  handlersRef.current = { fileCommands, edit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { fileCommands: f, edit: ed } = handlersRef.current;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (e.shiftKey) void f.saveAs();
        else void f.save();
        return;
      }
      if (ctrl && key === 'o') return e.preventDefault(), void f.open();
      if (ctrl && key === 'n') return e.preventDefault(), f.newDrawing();
      if (typing) return;
      if (ctrl && key === 'z') return e.preventDefault(), e.shiftKey ? ed.redo() : ed.undo();
      if (ctrl && key === 'y') return e.preventDefault(), ed.redo();
      if (ctrl && key === 'a') return e.preventDefault(), ed.selectAll();
      if (ctrl && key === 'd') return e.preventDefault(), ed.duplicate();
      if (e.key === 'Delete' || e.key === 'Backspace') return e.preventDefault(), ed.deleteSelection();
      if (e.key === 'Escape') {
        if (stateRef.current.tool !== 'select') dispatch({ type: 'setTool', tool: 'select' });
        else dispatch({ type: 'setSelection', ids: [] });
        return;
      }
      if (!ctrl && !e.altKey && TOOL_KEYS[key]) return dispatch({ type: 'setTool', tool: TOOL_KEYS[key] });
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (arrows[e.key] && stateRef.current.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[e.key];
        const s = stateRef.current;
        dispatch({
          type: 'updateShapes',
          shapes: getShapes(s.doc, s.selection).map((sh) => moveShape(sh, dx * step, dy * step)),
          message: `Nudged ${step} mm`,
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="title-bar">
        <span className="app-title" data-testid="app-title">
          {APP_TITLE}
        </span>
        <span className="doc-title" data-testid="doc-title">
          {state.fileName}
          {dirty ? ' •' : ''}
        </span>
      </header>
      <nav className="tabs">
        <FileMenu commands={fileCommands} />
        {(['home', 'draw', 'view'] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} data-testid={`tab-${t}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <Ribbon tab={tab} state={state} dispatch={dispatch} zoom={viewport.zoom} view={view} edit={edit} />
      <main className="main">
        <DrawingCanvas
          state={state}
          dispatch={dispatch}
          viewport={viewport}
          setViewport={setViewport}
          onResize={onResize}
          cursorWorld={cursor}
          onCursor={setCursor}
          newId={newId}
        />
        <PropertiesPanel state={state} dispatch={dispatch} />
      </main>
      <StatusBar state={state} cursor={cursor} zoom={viewport.zoom} view={view} />
    </div>
  );
}
