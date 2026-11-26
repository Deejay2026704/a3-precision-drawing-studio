import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { pageLengthToWorld } from '../geometry/scale';
import { centredAtZoom, fitPage, zoomAt, type Viewport } from '../geometry/viewport';
import { vec, type Vec2 } from '../geometry/vec';
import { duplicateItems, getDimensions, getShapes, replaceDimensions, replaceShapes } from '../model/document';
import { moveDimension } from '../model/dimensions';
import { createIdGenerator } from '../model/ids';
import { moveShape } from '../model/operations';
import { addConstraint, constraintFromSelection } from '../model/constraints';
import type { ConstraintKind, DrawingDocument } from '../model/types';
import { DocumentFormatError, FILE_EXTENSION, FILE_FORMAT_VERSION, parseProject, serializeProject } from '../storage/documentStorage';
import { exportSvg } from '../storage/exportSvg';
import { exportPdf, type PdfLayout } from '../storage/exportPdf';
import { useDialog } from './Dialog';
import { LayersPanel } from './LayersPanel';
import { baseName, getAutosaveService, getFileService } from '../storage/fileService';
import { autosaveDue, DEFAULT_AUTOSAVE_INTERVAL_MS, makeAutosaveRecord, parseAutosaveRecord } from '../storage/autosave';
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
  a: 'arc',
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

  // ---- autosave (crash recovery; never writes the project file) ----
  const autosaveSvc = useMemo(() => getAutosaveService(), []);
  const [autosaveOn, setAutosaveOn] = useState(() => localStorage.getItem('a3-autosave-enabled') !== 'false');
  const autosaveOnRef = useRef(autosaveOn);
  autosaveOnRef.current = autosaveOn;
  const [autosaveInfo, setAutosaveInfo] = useState('');
  const lastAutosave = useRef<{ doc: DrawingDocument | null; at: number }>({ doc: null, at: Date.now() });
  const intervalMs = useRef(DEFAULT_AUTOSAVE_INTERVAL_MS);

  const writeAutosave = useCallback(
    async (content?: string) => {
      const s = stateRef.current;
      await autosaveSvc.write(content ?? makeAutosaveRecord(serializeProject(s.doc, projectSettingsOf(s)), s.fileName, s.filePath, new Date()));
      lastAutosave.current = { doc: s.doc, at: Date.now() };
      setAutosaveInfo(`Autosaved ${new Date().toLocaleTimeString()}`);
    },
    [autosaveSvc],
  );

  useEffect(() => {
    void window.a3Studio?.config().then((c) => {
      if (c.autosaveIntervalMs) intervalMs.current = c.autosaveIntervalMs;
    });
    const t = window.setInterval(() => {
      const s = stateRef.current;
      const due = autosaveDue({
        enabled: autosaveOnRef.current,
        dirty: isDirty(s),
        doc: s.doc,
        lastDoc: lastAutosave.current.doc,
        lastAtMs: lastAutosave.current.at,
        nowMs: Date.now(),
        intervalMs: intervalMs.current,
        editing: s.editBase !== null,
      });
      if (due) writeAutosave().catch((err: Error) => setAutosaveInfo(`⚠ Autosave failed: ${err.message}`));
    }, 1000);
    return () => window.clearInterval(t);
  }, [writeAutosave]);

  // Saved, discarded, or undone back to the saved state: the recovery copy is no longer needed.
  useEffect(() => {
    if (!dirty) {
      void autosaveSvc.clear();
      lastAutosave.current = { doc: null, at: Date.now() };
      setAutosaveInfo('');
    }
  }, [dirty, autosaveSvc]);

  const toggleAutosave = () => {
    const on = !autosaveOnRef.current;
    localStorage.setItem('a3-autosave-enabled', String(on));
    setAutosaveOn(on);
    if (!on) void autosaveSvc.clear();
    setAutosaveInfo('');
    lastAutosave.current = { doc: null, at: Date.now() };
    dispatch({ type: 'setMessage', message: `Autosave ${on ? 'on' : 'off'}` });
  };

  /** At start-up: offer drawings left behind by a crashed session. Returns true if one was recovered. */
  const offerRecovery = async (): Promise<boolean> => {
    const orphans = await autosaveSvc.orphans().catch(() => []);
    for (const o of orphans) {
      let text = '';
      let rec: ReturnType<typeof parseAutosaveRecord>;
      try {
        text = await autosaveSvc.read(o.id);
        rec = parseAutosaveRecord(text);
      } catch (err) {
        const a = await ask({
          title: 'Damaged automatic backup',
          message: 'An automatic backup from an earlier session could not be read.',
          detail: [(err as Error).message],
          buttons: [
            { id: 'keep', label: 'Keep it', kind: 'primary' },
            { id: 'delete', label: 'Delete it', kind: 'danger' },
          ],
          cancelId: 'keep',
          testId: 'dialog-recovery-damaged',
        });
        if (a.button === 'delete') await autosaveSvc.remove(o.id);
        continue;
      }
      const { record, loaded } = rec;
      const a = await ask({
        title: 'Recover unsaved drawing?',
        message: `The application closed before "${record.fileName}" was saved. An automatic backup was found.`,
        detail: [
          `Backed up: ${new Date(record.savedAt).toLocaleString()}`,
          `Original file: ${record.filePath ?? '(never saved)'}`,
          `${loaded.doc.shapes.length} objects, ${loaded.doc.dimensions.length} dimensions, ${loaded.doc.constraints.length} constraints`,
          'Recovering opens it as an UNSAVED drawing – your original file is not changed until you save.',
        ],
        buttons: [
          { id: 'recover', label: 'Recover', kind: 'primary' },
          { id: 'later', label: 'Keep for later' },
          { id: 'discard', label: 'Discard backup', kind: 'danger' },
        ],
        cancelId: 'later',
        testId: 'dialog-recovery',
      });
      if (a.button === 'recover') {
        dispatch({
          type: 'loadDocument',
          doc: loaded.doc,
          path: record.filePath,
          name: record.fileName,
          settings: loaded.settings,
          sourceVersion: loaded.sourceVersion,
          recovered: true,
          message: `Recovered "${record.fileName}" from the backup of ${new Date(record.savedAt).toLocaleTimeString()} – not saved yet`,
        });
        fit();
        // Hand the backup over to this session BEFORE deleting the old one: there is always a copy.
        await autosaveSvc.write(text);
        lastAutosave.current = { doc: null, at: Date.now() };
        await autosaveSvc.remove(o.id);
        return true;
      }
      if (a.button === 'discard') {
        const sure = await ask({
          title: 'Discard backup permanently?',
          message: `The unsaved changes to "${record.fileName}" will be lost. This cannot be undone.`,
          buttons: [
            { id: 'cancel', label: 'Keep it', kind: 'primary' },
            { id: 'discard', label: 'Discard', kind: 'danger' },
          ],
          cancelId: 'cancel',
          testId: 'dialog-recovery-confirm',
        });
        if (sure.button === 'discard') await autosaveSvc.remove(o.id);
      }
    }
    return false;
  };

  // Files handed over by the OS (double-click, "Open with", second launch, macOS open-file).
  const openPathRef = useRef<(p: string) => Promise<void>>(async () => undefined);
  openPathRef.current = async (p: string) => {
    if (!window.a3Studio) return;
    if (!(await confirmDiscard(`opening "${baseName(p)}"`))) return;
    try {
      const res = await window.a3Studio.readPath(p);
      await openText(res.path, res.content);
    } catch (err) {
      dispatch({ type: 'setMessage', message: `⚠ Could not open ${baseName(p)}: ${(err as Error).message}` });
    }
  };
  const startupDone = useRef(false);
  useEffect(() => {
    if (startupDone.current) return;
    startupDone.current = true;
    void (async () => {
      const recovered = await offerRecovery();
      const pending = await window.a3Studio?.takePendingOpen();
      if (pending && !recovered) await openPathRef.current(pending);
    })();
    return window.a3Studio?.onOpenFile((p) => void openPathRef.current(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (s.recovered) {
      const a = await ask({
        title: 'Save recovered drawing?',
        message: `This drawing was recovered from an automatic backup. Save it over the original file "${s.fileName}"?`,
        detail: ['The original file may contain an older version of this drawing (or may have been changed since).', 'Choose "Save as a new file…" to keep the original as it is.'],
        buttons: [
          { id: 'overwrite', label: 'Save over original', kind: 'primary' },
          { id: 'saveas', label: 'Save as a new file…' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
        testId: 'dialog-save-recovered',
      });
      if (a.button === 'cancel') return false;
      if (a.button === 'saveas') return saveAs();
    }
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

  /** Parse and load project text; on any problem show it and leave the open drawing untouched. */
  const openText = async (path: string, content: string) => {
    try {
      const loaded = parseProject(content);
      dispatch({
        type: 'loadDocument',
        doc: loaded.doc,
        path,
        name: baseName(path),
        settings: loaded.settings,
        sourceVersion: loaded.sourceVersion,
        message: `Opened ${baseName(path)}${loaded.sourceVersion < FILE_FORMAT_VERSION ? ` (upgraded from format ${loaded.sourceVersion})` : ''}`,
      });
      fit();
      if (loaded.warnings.length) {
        await ask({
          title: 'Opened with notes',
          message: `"${baseName(path)}" was opened. Please review:`,
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
        message: `"${baseName(path)}" could not be opened.`,
        detail: [msg, 'Your current drawing has not been changed.'],
        buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
        cancelId: 'ok',
        testId: 'dialog-error',
      });
    }
  };

  const exportPdfWith = async (layout: PdfLayout) => {
    const s = stateRef.current;
    const suffix = layout === 'a3' ? '' : layout === 'a4-tiled' ? '-A4-tiled' : '-A4-fit';
    const name = s.fileName.replace(/\.a3d$/i, '') + suffix + '.pdf';
    try {
      const bytes = exportPdf(s.doc, { title: s.fileName.replace(/\.a3d$/i, ''), layout });
      const path = await files.exportPdf(bytes, name);
      if (!path) return;
      const how =
        layout === 'a3'
          ? 'A3 at true scale (print at 100 % / Actual size)'
          : layout === 'a4-tiled'
            ? 'A4 tiles at true scale (print at 100 % / Actual size)'
            : 'fitted to A4 – NOT to scale';
      dispatch({ type: 'setMessage', message: `Exported ${baseName(path)} – ${how}, visible layers only` });
    } catch (err) {
      dispatch({ type: 'setMessage', message: `⚠ PDF export failed: ${(err as Error).message}` });
    }
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
      if (res) await openText(res.path, res.content);
    },
    save: async () => {
      await save();
    },
    saveAs: async () => {
      await saveAs();
    },
    exportPdfA4: async () => {
      const a = await ask({
        title: 'Export PDF for an A4 printer',
        message: 'How should the A3 sheet be printed on A4 paper?',
        detail: [
          'Tiled: 4 A4 landscape pages at TRUE SCALE with 10 mm overlap and alignment marks – print at 100 % / Actual size, then tape the pages together.',
          'Fit: the whole sheet reduced onto one A4 page – NOT to scale (marked on the page).',
        ],
        choice: { label: 'Layout', options: [{ value: 'a4-tiled', label: 'Tiled – true scale (4 pages)' }, { value: 'a4-fit', label: 'Fit to one page – not to scale' }] },
        buttons: [
          { id: 'export', label: 'Export…', kind: 'primary' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
        testId: 'dialog-pdf-layout',
      });
      if (a.button !== 'export') return;
      await exportPdfWith(a.choice === 'a4-fit' ? 'a4-fit' : 'a4-tiled');
    },
    exportPdf: async () => exportPdfWith('a3'),
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
    toggleAutosave,
    autosaveLabel: `Autosave: ${autosaveOn ? 'On' : 'Off'} (every ${Math.round(DEFAULT_AUTOSAVE_INTERVAL_MS / 60000)} min)`,
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
      if (ctrl && key === 'p') return e.preventDefault(), void f.exportPdf();
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
      <StatusBar state={state} dispatch={dispatch} cursor={cursor} feedback={feedback} zoom={viewport.zoom} view={view} autosave={autosaveOn ? autosaveInfo || 'Autosave on' : 'Autosave off'} />
    </div>
  );
}
