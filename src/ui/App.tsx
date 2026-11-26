import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { pageLengthToWorld } from '../geometry/scale';
import { centredAtZoom, fitPage, zoomAt, type Viewport } from '../geometry/viewport';
import { vec, type Vec2 } from '../geometry/vec';
import { duplicateItems, getDimensions, getShapes, replaceDimensions, replaceShapes } from '../model/document';
import { moveDimension } from '../model/dimensions';
import { createIdGenerator } from '../model/ids';
import { moveShape } from '../model/operations';
import { addConstraint, constraintFromSelection } from '../model/constraints';
import type { ConstraintKind } from '../model/types';
import { DocumentFormatError, FILE_EXTENSION, FILE_FORMAT_VERSION, parseProject, serializeProject } from '../storage/documentStorage';
import { exportSvg } from '../storage/exportSvg';
import { useDialog } from './Dialog';
import { LayersPanel } from './LayersPanel';
import { baseName, getFileService } from '../storage/fileService';
import { DrawingCanvas } from './DrawingCanvas';
import { FileMenu, type FileCommands } from './FileMenu';
import { PropertiesPanel } from './PropertiesPanel';
import { Ribbon, type EditCommands, type RibbonTab, type ViewCommands } from './Ribbon';
import { StatusBar } from './StatusBar';
import { createInitialState, editorReducer, isDirty, projectSettingsOf, type ToolId } from './state/editorReducer';

export const APP_TITLE = 'A3 Precision Drawing Studio';
const DUPLICATE_OFFSET_PAPER_MM = 10;

/** Single-key tool shortcuts. Ignored while typing in any input, select or text field. */
export const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  l: 'line',
  r: 'rect',
  c: 'circle',
  f: 'freehand',
  t: 'trim',
  e: 'extend',
  o: 'offset',
  m: 'mirror',
  d: 'dim-aligned',
};

/** True when keyboard input belongs to a text/numeric field rather than the drawing. */
export const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLSelectElement ||
  t instanceof HTMLTextAreaElement ||
  (t instanceof HTMLElement && t.isContentEditable);

export function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);
  const [tab, setTab] = useState<RibbonTab>('home');
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, originX: 0, originY: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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
      const { doc, newIds } = duplicateItems(s.doc, s.selection, newId, vec(off, -off));
      dispatch({
        type: 'commitDocument',
        doc,
        selection: newIds,
        message: `Duplicated ${newIds.length} object${newIds.length === 1 ? '' : 's'}`,
      });
    },
  };

  // ---- file commands ----
  const [dialog, ask] = useDialog();

  /** Serialised project: document + active layer + display preferences. */
  const projectText = () => serializeProject(stateRef.current.doc, projectSettingsOf(stateRef.current));

  /** Returns true if the project was written. Never throws. */
  const saveAs = async (): Promise<boolean> => {
    const s = stateRef.current;
    try {
      const name = s.fileName.endsWith(`.${FILE_EXTENSION}`) ? s.fileName : `${s.fileName}.${FILE_EXTENSION}`;
      const path = await files.saveAs(projectText(), name);
      if (!path) return false;
      dispatch({ type: 'markSaved', path, name: baseName(path) });
      return true;
    } catch (err) {
      await ask({
        title: 'Save failed',
        message: `The drawing could not be saved: ${(err as Error).message}`,
        detail: ['Nothing was overwritten. Your drawing is still open and unchanged.'],
        buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
        cancelId: 'ok',
        testId: 'dialog-error',
      });
      return false;
    }
  };

  const save = async (): Promise<boolean> => {
    const s = stateRef.current;
    if (!s.filePath || !files.canSaveInPlace) return saveAs();
    if (s.sourceVersion !== null && s.sourceVersion < FILE_FORMAT_VERSION) {
      const a = await ask({
        title: 'Upgrade project file?',
        message: `"${s.fileName}" was created by an earlier version (format ${s.sourceVersion}). Saving will upgrade it to format ${FILE_FORMAT_VERSION}, which earlier versions of the application cannot open.`,
        buttons: [
          { id: 'upgrade-save', label: 'Upgrade and save', kind: 'primary' },
          { id: 'saveas', label: 'Save as a new file…' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
        testId: 'dialog-upgrade',
      });
      if (a.button === 'cancel') return false;
      if (a.button === 'saveas') return saveAs();
    }
    try {
      const path = await files.save(s.filePath, projectText());
      dispatch({ type: 'markSaved', path, name: baseName(path) });
      return true;
    } catch (err) {
      await ask({
        title: 'Save failed',
        message: `The drawing could not be saved: ${(err as Error).message}`,
        detail: ['The file on disk was not changed (saves are written to a temporary file first).', 'Try File ▸ Save As to save elsewhere.'],
        buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
        cancelId: 'ok',
        testId: 'dialog-error',
      });
      return false;
    }
  };

  /** Before replacing a modified drawing: Save / Don't save / Cancel. Resolves true to continue. */
  const confirmDiscard = async (action: string): Promise<boolean> => {
    if (!isDirty(stateRef.current)) return true;
    const a = await ask({
      title: 'Unsaved changes',
      message: `Save changes to "${stateRef.current.fileName}" before ${action}?`,
      buttons: [
        { id: 'save', label: 'Save', kind: 'primary' },
        { id: 'discard', label: "Don't save", kind: 'danger' },
        { id: 'cancel', label: 'Cancel' },
      ],
      cancelId: 'cancel',
      testId: 'dialog-unsaved',
    });
    if (a.button === 'cancel') return false;
    if (a.button === 'save') return save();
    return true;
  };

  const fileCommands: FileCommands = {
    newDrawing: async () => {
      if (!(await confirmDiscard('creating a new drawing'))) return;
      dispatch({ type: 'newDocument' });
      fit();
    },
    open: async () => {
      if (!(await confirmDiscard('opening another drawing'))) return;
      let res: { path: string; content: string } | null;
      try {
        res = await files.open();
      } catch (err) {
        dispatch({ type: 'setMessage', message: `Could not read file: ${(err as Error).message}` });
        return;
      }
      if (!res) return;
      try {
        const loaded = parseProject(res.content);
        dispatch({
          type: 'loadDocument',
          doc: loaded.doc,
          path: res.path,
          name: baseName(res.path),
          settings: loaded.settings,
          sourceVersion: loaded.sourceVersion,
          message: `Opened ${baseName(res.path)}${loaded.sourceVersion < FILE_FORMAT_VERSION ? ` (upgraded from format ${loaded.sourceVersion})` : ''}`,
        });
        fit();
        if (loaded.warnings.length) {
          await ask({
            title: 'Opened with notes',
            message: `"${baseName(res.path)}" was opened. Please review:`,
            detail: loaded.warnings,
            buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
            cancelId: 'ok',
            testId: 'dialog-warnings',
          });
        }
      } catch (err) {
        const msg = err instanceof DocumentFormatError ? err.message : (err as Error).message;
        dispatch({ type: 'setMessage', message: `Could not open file: ${msg}` });
        await ask({
          title: 'Cannot open file',
          message: `"${baseName(res.path)}" could not be opened.`,
          detail: [msg, 'Your current drawing has not been changed.'],
          buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
          cancelId: 'ok',
          testId: 'dialog-error',
        });
      }
    },
    save: async () => {
      await save();
    },
    saveAs: async () => {
      await saveAs();
    },
    exportSvg: async () => {
      const s = stateRef.current;
      const name = s.fileName.replace(/\.a3d$/i, '') + '.svg';
      try {
        const path = await files.exportSvg(exportSvg(s.doc), name);
        if (path) dispatch({ type: 'setMessage', message: `Exported ${baseName(path)} (visible layers only)` });
      } catch (err) {
        dispatch({ type: 'setMessage', message: `⚠ Export failed: ${(err as Error).message}` });
      }
    },
    exit: () => (window.a3Studio ? window.a3Studio.quit() : window.close()),
  };

  // ---- constraints from the current selection ----
  const constrain = (kind: ConstraintKind) => {
    const s = stateRef.current;
    const c = constraintFromSelection(kind, getShapes(s.doc, s.selection), newId());
    if (typeof c === 'string') return dispatch({ type: 'setMessage', message: `⚠ ${c}` });
    const r = addConstraint(s.doc, c);
    if (!r.ok) return dispatch({ type: 'setMessage', message: `⚠ ${r.message}` });
    dispatch({ type: 'commitDocument', doc: r.doc, message: r.message });
  };

  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = dialog !== null;

  // ---- keyboard shortcuts ----
  const handlersRef = useRef({ fileCommands, edit });
  handlersRef.current = { fileCommands, edit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpenRef.current) return; // a modal dialog owns the keyboard
      const { fileCommands: f, edit: ed } = handlersRef.current;
      const typing = isTypingTarget(e.target);
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
      if (ctrl && key === 'n') return e.preventDefault(), void f.newDrawing();
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
      if (e.key === 'F3') {
        e.preventDefault();
        const on = !stateRef.current.view.objectSnap;
        dispatch({ type: 'setView', view: { objectSnap: on } });
        return dispatch({ type: 'setMessage', message: `Object snap ${on ? 'on' : 'off'}` });
      }
      if (e.key === 'F9') {
        e.preventDefault();
        const on = !stateRef.current.view.snapEnabled;
        dispatch({ type: 'setView', view: { snapEnabled: on } });
        return dispatch({ type: 'setMessage', message: `Grid snap ${on ? 'on' : 'off'}` });
      }
      if (!ctrl && !e.altKey && !e.shiftKey && TOOL_KEYS[key]) return dispatch({ type: 'setTool', tool: TOOL_KEYS[key] });
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (arrows[e.key] && stateRef.current.selection.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[e.key];
        const s = stateRef.current;
        const doc = replaceDimensions(
          replaceShapes(s.doc, getShapes(s.doc, s.selection).map((sh) => moveShape(sh, dx * step, dy * step))),
          getDimensions(s.doc, s.selection).map((dm) => moveDimension(dm, dx * step, dy * step)),
        );
        dispatch({ type: 'commitDocument', doc, message: `Nudged ${step} mm` });
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
        {dirty && (
          <span className="unsaved-badge" data-testid="unsaved-indicator" title="This drawing has changes that are not saved yet (Ctrl+S)">
            Unsaved changes
          </span>
        )}
      </header>
      <nav className="tabs">
        <FileMenu commands={fileCommands} />
        {(['home', 'draw', 'annotate', 'constrain', 'view'] as const).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} data-testid={`tab-${t}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <Ribbon tab={tab} state={state} dispatch={dispatch} zoom={viewport.zoom} view={view} edit={edit} constrain={constrain} />
      <main className="main">
        <DrawingCanvas
          state={state}
          dispatch={dispatch}
          viewport={viewport}
          setViewport={setViewport}
          onResize={onResize}
          cursorWorld={cursor}
          onCursor={setCursor}
          onFeedback={setFeedback}
          newId={newId}
        />
        <div className="sidebar">
          <LayersPanel state={state} dispatch={dispatch} ask={ask} newId={newId} />
          <PropertiesPanel state={state} dispatch={dispatch} newId={newId} />
        </div>
      </main>
      {dialog}
      <StatusBar state={state} dispatch={dispatch} cursor={cursor} feedback={feedback} zoom={viewport.zoom} view={view} />
    </div>
  );
}
