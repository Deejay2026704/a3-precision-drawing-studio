import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from 'react';
import { angleBetweenPoints, polarPoint, snapAngle } from '../geometry/angles';
import { boundsFromCorners } from '../geometry/bounds';
import { screenLengthToWorld, screenToWorld, worldToScreen, type ViewTransform } from '../geometry/coords';
import { formatNumber, snapValue } from '../geometry/units';
import { panBy, zoomAt, type Viewport } from '../geometry/viewport';
import { distance, sub, vec, type Vec2 } from '../geometry/vec';
import { getDimensions, getShapes, replaceDimensions, replaceShapes } from '../model/document';
import {
  applyDimensionGrip,
  distanceToDimensionLayout,
  hitTestDimensions,
  layoutDimension,
  moveDimension,
  type DimGripId,
} from '../model/dimensions';
import { applyHandleDrag, getSelectionFrame, type HandleId, type SelectionFrame } from '../model/handles';
import { distanceToShape, hitTest, shapesInsideBounds } from '../model/hitTest';
import { moveShape } from '../model/operations';
import { createCircle, createLine, createPolyline, createRectFromCorners, lineAngle, lineLength } from '../model/shapes';
import { findSnap, type SnapResult, type SnapSettings } from '../model/snap';
import { editableDimensions, editableShapes, isEditable, isVisible, resolveFill, resolveStroke, visibleDimensions, visibleShapes } from '../model/layers';
import { CONSTRAINT_GLYPHS, constraintMarkerAnchors, constraintShapeIds, constraintStatus, type ConstraintStatus } from '../model/constraints';
import type { Constraint, Dimension, Shape, ShapeId } from '../model/types';
import { DimensionLayoutView, DimensionView } from '../render/DimensionView';
import { PageView } from '../render/PageView';
import { HorizontalRuler, RULER_SIZE, VerticalRuler } from '../render/Rulers';
import { DimensionGrips, HANDLE_SIZE_PX, ROTATE_HANDLE_OFFSET_PX, SelectionOverlay } from '../render/SelectionOverlay';
import { CursorFeedback, SnapMarker } from '../render/SnapMarker';
import { ShapeView } from '../render/ShapeView';
import { SheetView } from '../render/SheetView';
import { newSession, sessionInProgress, toolClick, toolFinish, toolPreview, toolUndoPoint, type SessionTool, type ToolInput, type ToolSession, type ToolStep } from './interaction/toolSession';
import { snapSettingsOf, TOOL_PROMPTS, type EditorAction, type EditorState, type ToolId } from './state/editorReducer';

const HIT_TOLERANCE_PX = 6;
/** Snap aperture: object snaps capture within this many screen pixels (converted to drawing mm). */
export const SNAP_APERTURE_PX = 10;
const DRAG_THRESHOLD_PX = 3;
const FREEHAND_MIN_STEP_PX = 2;

const DRAW_TOOLS: readonly ToolId[] = ['line', 'rect', 'circle', 'freehand'];
const isSessionTool = (t: ToolId): t is SessionTool => !DRAW_TOOLS.includes(t) && t !== 'select';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startViewport: Viewport }
  | { kind: 'move'; startScreen: Vec2; startWorld: Vec2; base: Vec2; originals: Shape[]; dims: Dimension[]; active: boolean }
  | { kind: 'handle'; handle: HandleId; frame: SelectionFrame; startWorld: Vec2; originals: Shape[]; base: Vec2 | null }
  | { kind: 'dimgrip'; grip: DimGripId; original: Dimension }
  | { kind: 'marquee'; startScreen: Vec2; additive: boolean }
  /** clickMode: started with a click (no drag) – the next click sets the second point. */
  | { kind: 'draw'; tool: ToolId; startWorld: Vec2; startScreen: Vec2; points: Vec2[]; lastScreen: Vec2; clickMode: boolean };

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  viewport: Viewport;
  setViewport: (update: Viewport | ((vp: Viewport) => Viewport)) => void;
  onResize: (width: number, height: number) => void;
  cursorWorld: Vec2 | null;
  onCursor: (p: Vec2 | null) => void;
  onFeedback: (text: string | null) => void;
  newId: () => ShapeId;
}

const fmt = (v: number) => formatNumber(v, 3);

/** Live readout for a shape being drawn or edited. */
function describeShape(s: Shape): string {
  switch (s.kind) {
    case 'line':
      return `L ${fmt(lineLength(s))} mm  ∠ ${formatNumber(lineAngle(s), 2)}°`;
    case 'rect':
      return `${fmt(s.width)} × ${fmt(s.height)} mm`;
    case 'circle':
      return `R ${fmt(s.radius)}  ⌀ ${fmt(2 * s.radius)} mm`;
    case 'arc':
      return `R ${fmt(s.radius)}  ∠ ${formatNumber(s.sweepDeg, 2)}°  L ${fmt((s.radius * s.sweepDeg * Math.PI) / 180)} mm`;
    case 'polyline':
      return `${s.points.length} points${s.closed ? ' (closed)' : ''}`;
  }
}

/**
 * Workspace: rulers + SVG canvas. Pointer input is converted from screen px to drawing mm
 * exactly once, snapped against drawing geometry, then turned into model operations.
 */
export function DrawingCanvas({ state, dispatch, viewport, setViewport, onResize, cursorWorld, onCursor, onFeedback, newId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string>('default');
  const [panning, setPanning] = useState(false);
  const [snapShown, setSnapShown] = useState<SnapResult | null>(null);
  const [feedback, setFeedbackState] = useState<string | null>(null);
  const [hover, setHover] = useState<{ raw: Vec2; point: Vec2; snap: SnapResult | null; screen: Vec2 } | null>(null);
  const [sessionState, setSession] = useState<ToolSession | null>(null);
  const sessionRef = useRef<ToolSession | null>(null);

  const { doc, selection, tool, view } = state;
  // Derived synchronously from the CURRENT tool, so a click made immediately after a tool
  // change can never be handled by the previous tool (no wait for an effect to run).
  const session: ToolSession | null = isSessionTool(tool)
    ? sessionState && sessionState.tool === tool
      ? sessionState
      : newSession(tool)
    : null;
  sessionRef.current = session;
  const transform: ViewTransform = useMemo(() => ({ scale: doc.scale, viewport }), [doc.scale, viewport]);
  const selectedShapes = useMemo(() => getShapes(doc, selection), [doc, selection]);
  const selectedDims = useMemo(() => getDimensions(doc, selection), [doc, selection]);
  const frame = useMemo(
    () => getSelectionFrame(selectedShapes, screenLengthToWorld(ROTATE_HANDLE_OFFSET_PX, transform)),
    [selectedShapes, transform],
  );
  const singleDim = selectedShapes.length === 0 && selectedDims.length === 1 ? selectedDims[0] : null;
  const singleDimLayout = singleDim ? layoutDimension(doc, singleDim, doc.scale) : null;
  const snapSettings: SnapSettings = useMemo(() => snapSettingsOf(view), [view]);
  // Layer filtering: what is drawn/snapped (visible) and what can be picked/edited (visible + unlocked).
  const shown = useMemo(() => visibleShapes(doc), [doc]);
  const shownDims = useMemo(() => visibleDimensions(doc), [doc]);
  const pickable = useMemo(() => editableShapes(doc), [doc]);
  const pickableDoc = useMemo(() => ({ ...doc, dimensions: editableDimensions(doc) }), [doc]);
  const markers = useMemo(() => layoutConstraintMarkers(doc, transform), [doc, transform]);
  const aperture = screenLengthToWorld(SNAP_APERTURE_PX, transform);

  const setFeedback = (t: string | null) => {
    setFeedbackState(t);
    onFeedback(t);
  };

  // ---- size tracking ----
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
      onResize(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onResize]);

  // ---- wheel zoom about the cursor (needs a non-passive listener) ----
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = vec(e.clientX - r.left, e.clientY - r.top);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setViewport((vp) => zoomAt(vp, vp.zoom * factor, anchor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  // ---- Space (pan) and Escape (cancel the current step before the app handles Esc) ----
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Space') {
        spaceDown.current = true;
        e.preventDefault();
      }
      if ((e.key === 'Enter' || e.key === 'Backspace') && sessionInProgress(sessionRef.current)) {
        const s = sessionRef.current!;
        if (e.key === 'Enter') {
          const step = finishRef.current(s);
          if (step) {
            applyStepRef.current(step);
            e.preventDefault();
            e.stopPropagation();
          }
        } else {
          const next = toolUndoPoint(s);
          if (next) {
            setSession(next);
            e.preventDefault();
            e.stopPropagation(); // not "delete selection"
          }
        }
        return;
      }
      if (e.key !== 'Escape') return;
      const d = dragRef.current;
      if (d) {
        if (d.kind === 'move' || d.kind === 'handle' || d.kind === 'dimgrip') dispatch({ type: 'cancelEdit' });
        dragRef.current = null;
        setDraft(null);
        setMarquee(null);
        setFeedback(null);
        e.stopPropagation();
        return;
      }
      const s = sessionRef.current;
      if (sessionInProgress(s)) {
        setSession(newSession(s!.tool));
        dispatch({ type: 'setMessage', message: TOOL_PROMPTS[s!.tool] });
        setFeedback(null);
        e.stopPropagation();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Changing tool discards unfinished input.
  useEffect(() => {
    setDraft(null);
    setSnapShown(null);
    setFeedback(null);
    if (dragRef.current?.kind === 'draw') dragRef.current = null;
    setSession(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const localPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };

  const snapAt = (raw: Vec2, opts: { base?: Vec2 | null; exclude?: ReadonlySet<ShapeId> } = {}): SnapResult | null =>
    findSnap(raw, snapSettings, { shapes: shown, tolerance: aperture, basePoint: opts.base ?? null, excludeIds: opts.exclude });

  const findHandle = (sp: Vec2): HandleId | null => {
    if (!frame || tool !== 'select') return null;
    // Grips are checked first so a centre grip wins over an overlapping resize handle.
    const ordered = [...frame.handles].sort((a, b) => Number(b.id === 'move') - Number(a.id === 'move'));
    for (const h of ordered) {
      const hp = worldToScreen(h.position, transform);
      if (Math.abs(hp.x - sp.x) <= HANDLE_SIZE_PX / 2 + 3 && Math.abs(hp.y - sp.y) <= HANDLE_SIZE_PX / 2 + 3) return h.id;
    }
    return null;
  };

  const findDimGrip = (sp: Vec2): DimGripId | null => {
    if (!singleDimLayout || tool !== 'select') return null;
    for (const g of singleDimLayout.grips) {
      const p = worldToScreen(g.position, transform);
      if (Math.abs(p.x - sp.x) <= HANDLE_SIZE_PX / 2 + 3 && Math.abs(p.y - sp.y) <= HANDLE_SIZE_PX / 2 + 3) return g.id;
    }
    return null;
  };

  /**
   * Item under the cursor in the Select tool: the closest of the topmost shape and the
   * topmost dimension. Geometry wins ties (a dimension's arrow tip often sits exactly on it);
   * dimensions are still easy to pick by their text or dimension line.
   */
  const pickAt = (wp: Vec2): { hit: Shape | Dimension | null; hitDim: Dimension | null } => {
    const tol = screenLengthToWorld(HIT_TOLERANCE_PX, transform);
    const shape = hitTest(pickable, wp, tol);
    const dim = hitTestDimensions(pickableDoc, wp, tol);
    if (!dim) return { hit: shape, hitDim: null };
    if (!shape) return { hit: dim, hitDim: dim };
    const lay = layoutDimension(doc, dim, doc.scale);
    const dDim = lay ? distanceToDimensionLayout(lay, wp) : Infinity;
    return distanceToShape(shape, wp) <= dDim ? { hit: shape, hitDim: null } : { hit: dim, hitDim: dim };
  };

  const buildDraft = (d: Extract<Drag, { kind: 'draw' }>, current: Vec2, constrain: boolean): Shape | null => {
    const style = state.drawStyle;
    const a = d.startWorld;
    switch (tool) {
      case 'line': {
        let b = current;
        if (constrain) b = polarPoint(a, distance(a, b), snapAngle(angleBetweenPoints(a, b), 15));
        return createLine('draft', a, b, style);
      }
      case 'rect': {
        let b = current;
        if (constrain) {
          const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          b = vec(a.x + Math.sign(b.x - a.x || 1) * side, a.y + Math.sign(b.y - a.y || 1) * side);
        }
        return createRectFromCorners('draft', a, b, style);
      }
      case 'circle':
        return createCircle('draft', a, distance(a, current), style);
      case 'freehand':
        return createPolyline('draft', d.points, style);
      default:
        return null;
    }
  };

  const finishDraw = (d: Extract<Drag, { kind: 'draw' }>, current: Vec2, constrain: boolean) => {
    dragRef.current = null;
    const shape = buildDraft(d, current, constrain);
    setDraft(null);
    setFeedback(null);
    if (!shape || !isMeaningful(shape)) {
      dispatch({ type: 'setMessage', message: 'Nothing created: the object would have zero size' });
      return;
    }
    const created = { ...shape, id: newId() };
    dispatch({ type: 'addShapes', shapes: [created], message: describeCreated(created) });
  };

  const toolInput = (raw: Vec2, snap: SnapResult | null): ToolInput => ({
    doc,
    selection,
    raw,
    point: snap?.point ?? raw,
    snap,
    tolerance: screenLengthToWorld(HIT_TOLERANCE_PX, transform),
    dimStyle: state.dimStyle,
    offsetDistanceMm: state.offsetDistanceMm,
    mirrorKeepSource: state.mirrorKeepSource,
    newId,
    drawStyle: state.drawStyle,
    filletRadiusMm: state.filletRadiusMm,
    chamferDistanceMm: state.chamferDistanceMm,
    polygonSides: state.polygonSides,
    canEdit: (sh) => isEditable(doc, sh),
    canSee: (sh) => isVisible(doc, sh),
  });

  const applyStep = (step: ToolStep) => {
    setSession(step.session);
    if (step.kind === 'continue') {
      if (step.selection) dispatch({ type: 'setSelection', ids: step.selection });
      dispatch({ type: 'setMessage', message: step.prompt });
    } else if (step.kind === 'commit') {
      dispatch({ type: 'commitDocument', doc: step.doc, selection: step.selection, message: step.message });
      setFeedback(null);
    } else {
      dispatch({ type: 'setMessage', message: `⚠ ${step.message}` });
    }
  };
  const applyStepRef = useRef(applyStep);
  applyStepRef.current = applyStep;
  const finishRef = useRef((s: ToolSession) => toolFinish(s, toolInput(hover?.raw ?? vec(0, 0), null)));
  finishRef.current = (s: ToolSession) => toolFinish(s, toolInput(hover?.raw ?? vec(0, 0), null));

  /** Base point for perpendicular / tangent snaps in the current context. */
  const contextBase = (): Vec2 | null => {
    const d = dragRef.current;
    if (d?.kind === 'draw' && tool === 'line') return d.startWorld;
    if (d?.kind === 'handle') return d.base;
    if (session && session.points.length > 0) return session.points[session.points.length - 1];
    return null;
  };

  // ---------------- pointer handlers ----------------

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const sp = localPoint(e);
    const wp = screenToWorld(sp, transform);
    (document.activeElement as HTMLElement | null)?.blur?.(); // commit any pending numeric entry

    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { kind: 'pan', startScreen: sp, startViewport: viewport };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Second click of a click-click drawing.
    const pending = dragRef.current;
    if (pending?.kind === 'draw' && pending.tool !== tool) {
      dragRef.current = null; // started with another tool: discard
      setDraft(null);
    } else if (pending?.kind === 'draw' && pending.clickMode) {
      const p = tool === 'freehand' ? wp : (snapAt(wp, { base: tool === 'line' ? pending.startWorld : null })?.point ?? wp);
      finishDraw(pending, p, e.shiftKey);
      return;
    }

    if (tool === 'select') {
      const handle = findHandle(sp);
      if (handle && frame) {
        dispatch({ type: 'beginEdit' });
        const s0 = selectedShapes[0];
        const base = selectedShapes.length === 1 && s0.kind === 'line' ? (handle === 'start' ? s0.end : handle === 'end' ? s0.start : null) : null;
        dragRef.current = { kind: 'handle', handle, frame, startWorld: wp, originals: selectedShapes, base };
        return;
      }
      const mk = markers.find((m) => sp.x >= m.x && sp.x <= m.x + m.w && sp.y >= m.y && sp.y <= m.y + m.h);
      if (mk) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) dispatch({ type: 'toggleSelection', id: mk.id });
        else dispatch({ type: 'setSelection', ids: [mk.id] });
        return;
      }
      const dg = findDimGrip(sp);
      if (dg && singleDim) {
        dispatch({ type: 'beginEdit' });
        dragRef.current = { kind: 'dimgrip', grip: dg, original: singleDim };
        return;
      }
      const { hit, hitDim } = pickAt(wp);
      if (hit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          dispatch({ type: 'toggleSelection', id: hit.id });
          return;
        }
        const ids = selection.includes(hit.id) ? selection : [hit.id];
        if (!selection.includes(hit.id)) dispatch({ type: 'setSelection', ids });
        dispatch({ type: 'beginEdit' });
        const shapes = getShapes(doc, ids);
        if (hitDim && shapes.length === 0 && ids.length === 1) {
          // Dragging a lone dimension moves its dimension line / leader / arc (placement only).
          const grip: DimGripId = hitDim.kind === 'radius' || hitDim.kind === 'diameter' ? 'leader' : hitDim.kind === 'angular' ? 'arc' : 'dimline';
          dragRef.current = { kind: 'dimgrip', grip, original: hitDim };
          return;
        }
        // Base point: if the grab is near an endpoint/midpoint/centre of the moved geometry, use it exactly.
        const baseSnap = snapSettings.objectSnap
          ? findSnap(wp, { ...snapSettings, gridSnap: false, kinds: { ...snapSettings.kinds, intersection: false, perpendicular: false, tangent: false, nearest: false } }, { shapes, tolerance: aperture })
          : null;
        dragRef.current = {
          kind: 'move',
          startScreen: sp,
          startWorld: wp,
          base: baseSnap?.point ?? wp,
          originals: shapes,
          dims: getDimensions(doc, ids),
          active: false,
        };
        return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) dispatch({ type: 'setSelection', ids: [] });
      dragRef.current = { kind: 'marquee', startScreen: sp, additive };
      setMarquee({ a: sp, b: sp });
      return;
    }

    if (session) {
      if (session.tool === 'mirror' && (e.shiftKey || e.ctrlKey)) {
        const s = hitTest(pickable, wp, screenLengthToWorld(HIT_TOLERANCE_PX, transform));
        if (s) dispatch({ type: 'toggleSelection', id: s.id });
        return;
      }
      const snap = snapAt(wp, { base: contextBase() });
      applyStep(toolClick(session, toolInput(wp, snap)));
      return;
    }

    // Drawing tools
    if (!DRAW_TOOLS.includes(tool)) return;
    const start = tool === 'freehand' ? wp : (snapAt(wp)?.point ?? wp);
    const d: Drag = { kind: 'draw', tool, startWorld: start, startScreen: sp, points: [start], lastScreen: sp, clickMode: false };
    dragRef.current = d;
    setDraft(buildDraft(d, start, e.shiftKey));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const sp = localPoint(e);
    const wp = screenToWorld(sp, transform);
    const d = dragRef.current;
    const drawing = d?.kind === 'draw' && tool !== 'freehand';
    const editing = d?.kind === 'move' || d?.kind === 'handle';
    const exclude = editing ? new Set(selection) : undefined;
    const wantSnap = drawing || editing || (session !== null) || (!d && DRAW_TOOLS.includes(tool) && tool !== 'freehand');
    const snap = wantSnap ? snapAt(wp, { base: contextBase(), exclude }) : null;
    const point = snap?.point ?? wp;
    setSnapShown(snap);
    setHover({ raw: wp, point, snap, screen: sp });
    onCursor(point);

    if (!d) {
      if (tool === 'select') {
        const h = findHandle(sp) ?? findDimGrip(sp);
        const overMarker = markers.some((m) => sp.x >= m.x && sp.x <= m.x + m.w && sp.y >= m.y && sp.y <= m.y + m.h);
        const over = !h && (overMarker || pickAt(wp).hit);
        setHoverCursor(h === 'rotate' ? 'grab' : h ? 'crosshair' : overMarker ? 'pointer' : over ? 'move' : 'default');
      } else if (session) {
        setFeedback(toolPreview(session, toolInput(wp, snap)).feedback);
      }
      return;
    }

    switch (d.kind) {
      case 'pan':
        setViewport(panBy(d.startViewport, sp.x - d.startScreen.x, sp.y - d.startScreen.y));
        break;
      case 'move': {
        if (!d.active && distance(sp, d.startScreen) < DRAG_THRESHOLD_PX) return;
        d.active = true;
        let delta: Vec2;
        if (snap && snap.kind !== 'grid') {
          delta = sub(snap.point, d.base); // object snap: base point lands exactly on the snap
        } else {
          delta = sub(wp, d.startWorld);
          if (view.snapEnabled) delta = vec(snapValue(delta.x, view.snapStepMm), snapValue(delta.y, view.snapStepMm));
        }
        if (e.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? vec(delta.x, 0) : vec(0, delta.y);
        const next = replaceDimensions(
          replaceShapes(doc, d.originals.map((s) => moveShape(s, delta.x, delta.y))),
          d.dims.map((dm) => moveDimension(dm, delta.x, delta.y)),
        );
        dispatch({ type: 'previewDocument', doc: next });
        setFeedback(`Δ ${fmt(delta.x)}, ${fmt(delta.y)} mm`);
        break;
      }
      case 'handle': {
        const shapes = applyHandleDrag(d.originals, d.frame, d.handle, d.startWorld, wp, {
          constrain: e.shiftKey,
          snapPoint: () => point,
        });
        dispatch({ type: 'previewShapes', shapes });
        if (d.handle === 'rotate') {
          const a = angleBetweenPoints(d.frame.pivot, wp) - angleBetweenPoints(d.frame.pivot, d.startWorld);
          setFeedback(`∠ ${formatNumber(e.shiftKey ? snapAngle(a, 15) : a, 2)}°`);
        } else if (shapes.length === 1) setFeedback(describeShape(shapes[0]));
        break;
      }
      case 'dimgrip': {
        const updated = applyDimensionGrip(doc, d.original, d.grip, wp);
        dispatch({ type: 'previewDocument', doc: replaceDimensions(doc, [updated]) });
        const lay = layoutDimension(doc, updated, doc.scale);
        setFeedback(lay ? `${lay.text} (driven)` : null);
        break;
      }
      case 'marquee':
        setMarquee({ a: d.startScreen, b: sp });
        break;
      case 'draw': {
        if (tool === 'freehand') {
          if (distance(sp, d.lastScreen) >= FREEHAND_MIN_STEP_PX) {
            d.points = [...d.points, wp];
            d.lastScreen = sp;
          }
        }
        const s = buildDraft(d, tool === 'freehand' ? wp : point, e.shiftKey);
        setDraft(s);
        if (s) setFeedback(describeShape(s));
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const sp = localPoint(e);
    switch (d.kind) {
      case 'pan':
        dragRef.current = null;
        setPanning(false);
        break;
      case 'move':
        dragRef.current = null;
        dispatch({ type: 'endEdit', message: `Moved ${d.originals.length + d.dims.length} object${d.originals.length + d.dims.length === 1 ? '' : 's'}` });
        setFeedback(null);
        break;
      case 'handle':
        dragRef.current = null;
        dispatch({ type: 'endEdit', message: d.handle === 'rotate' ? 'Rotated selection' : d.handle === 'move' || d.handle === 'start' || d.handle === 'end' ? 'Grip edit' : 'Resized selection' });
        setFeedback(null);
        break;
      case 'dimgrip':
        dragRef.current = null;
        dispatch({ type: 'endEdit', message: 'Dimension placement changed' });
        setFeedback(null);
        break;
      case 'marquee': {
        dragRef.current = null;
        setMarquee(null);
        if (distance(sp, d.startScreen) < DRAG_THRESHOLD_PX) break;
        const win = boundsFromCorners(screenToWorld(d.startScreen, transform), screenToWorld(sp, transform));
        const inside = shapesInsideBounds(pickable, win);
        dispatch({ type: 'setSelection', ids: d.additive ? [...new Set([...selection, ...inside])] : inside });
        break;
      }
      case 'draw': {
        if (d.clickMode) break; // waiting for the second click
        if (tool !== 'freehand' && distance(sp, d.startScreen) < DRAG_THRESHOLD_PX) {
          // A click rather than a drag: switch to click-click drawing.
          d.clickMode = true;
          dispatch({ type: 'setMessage', message: `${tool === 'circle' ? 'Circle' : tool === 'rect' ? 'Rectangle' : 'Line'}: click the ${tool === 'circle' ? 'radius point' : 'second point'}, or type exact values in Properties (Esc cancels)` });
          break;
        }
        const wp = screenToWorld(sp, transform);
        finishDraw(d, tool === 'freehand' ? wp : (hover?.point ?? wp), e.shiftKey);
        break;
      }
    }
  };

  // ---------------- rendering ----------------

  const preview = session && hover ? toolPreview(session, toolInput(hover.raw, hover.snap)) : null;
  const cursorScreen = cursorWorld ? worldToScreen(cursorWorld, transform) : null;
  const cursor = panning ? 'grabbing' : tool === 'select' ? hoverCursor : 'crosshair';
  const selectedSet = new Set(selection);

  return (
    // minmax(0, 1fr): the rulers (sized from the canvas) must never stop the workspace from shrinking.
    <div className="workspace" style={{ gridTemplateColumns: `${RULER_SIZE}px minmax(0, 1fr)`, gridTemplateRows: `${RULER_SIZE}px minmax(0, 1fr)` }}>
      <div className="ruler-corner" title="Units: millimetres (drawing units)">mm</div>
      <HorizontalRuler transform={transform} width={size.width} cursorX={cursorScreen?.x ?? null} />
      <VerticalRuler transform={transform} height={size.height} cursorY={cursorScreen?.y ?? null} />
      <div className="canvas-host" ref={hostRef}>
        <svg
          ref={svgRef}
          className="canvas"
          data-testid="canvas"
          data-tool={tool}
          width={size.width}
          height={size.height}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onDoubleClick={() => {
            const st = sessionRef.current;
            const step = st ? finishRef.current(st) : null;
            if (step) applyStep(step);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (!dragRef.current) {
              onCursor(null);
              setSnapShown(null);
              setHover(null);
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PageView page={doc.page} transform={transform} showGrid={view.showGrid} gridSpacingMm={view.gridSpacingMm} />
          <SheetView doc={doc} transform={transform} />
          <g data-testid="shapes">
            {shown.map((s) => (
              <ShapeView key={s.id} shape={s} transform={transform} stroke={selectedSet.has(s.id) && tool !== 'select' ? '#1a73e8' : resolveStroke(doc, s)} fillColor={resolveFill(doc, s) ?? undefined} scale={doc.scale} />
            ))}
          </g>
          <g data-testid="dimensions">
            {shownDims.map((dm) => (
              <DimensionView key={dm.id} dim={dm} doc={doc} transform={transform} highlight={selectedSet.has(dm.id) ? '#1a73e8' : undefined} />
            ))}
          </g>
          <g data-testid="constraint-markers">
            {markers.map((m, i) => (
              <g
                key={`${m.id}-${i}`}
                className={`cmark cmark-${m.status}${selectedSet.has(m.id) ? ' selected' : ''}`}
                data-constraint-id={m.id}
                data-constraint-kind={m.kind}
                data-status={m.status}
              >
                <title>{m.title}</title>
                <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={3} />
                <text x={m.x + m.w / 2} y={m.y + m.h / 2 + 4}>
                  {m.label}
                </text>
              </g>
            ))}
          </g>
          {draft && <ShapeView shape={draft} transform={transform} stroke="#1a73e8" />}
          {preview && (
            <g data-testid="tool-preview" pointerEvents="none">
              {preview.shapes.map((s) => (
                <ShapeView key={s.id} shape={s} transform={transform} stroke="#1a73e8" dashed />
              ))}
              {preview.dimensions.map((dm) => {
                const lay = layoutDimension(doc, dm, doc.scale);
                return lay ? <DimensionLayoutView key={dm.id} layout={lay} arrowhead={dm.style.arrowhead} transform={transform} color="#1a73e8" /> : null;
              })}
              {preview.removedShapes.map((s, i) => (
                <g key={i} className="trim-preview" data-testid="trim-preview">
                  <ShapeView shape={{ ...s, id: `__trim__${i}` }} transform={transform} stroke="#d93025" dashed />
                </g>
              ))}
            </g>
          )}
          {frame && <SelectionOverlay frame={frame} transform={transform} interactive={tool === 'select'} />}
          {singleDimLayout && tool === 'select' && <DimensionGrips grips={singleDimLayout.grips} transform={transform} />}
          {marquee && (
            <rect
              className="marquee"
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
            />
          )}
          {snapShown && <SnapMarker snap={snapShown} transform={transform} />}
          {feedback && hover && <CursorFeedback text={feedback} x={hover.screen.x} y={hover.screen.y} />}
        </svg>
      </div>
    </div>
  );
}

function isMeaningful(s: Shape): boolean {
  switch (s.kind) {
    case 'line':
      return lineLength(s) > 1e-9;
    case 'rect':
      return s.width > 1e-9 && s.height > 1e-9;
    case 'circle':
      return s.radius > 1e-9;
    case 'arc':
      return s.radius > 1e-9 && s.sweepDeg > 1e-9;
    case 'polyline':
      return s.points.length >= 2;
  }
}

export function describeCreated(s: Shape): string {
  switch (s.kind) {
    case 'line':
      return `Line created – length ${formatNumber(lineLength(s))} mm`;
    case 'rect':
      return `Rectangle created – ${formatNumber(s.width)} × ${formatNumber(s.height)} mm`;
    case 'circle':
      return `Circle created – radius ${formatNumber(s.radius)} mm`;
    case 'arc':
      return `Arc created – radius ${formatNumber(s.radius)} mm, ${formatNumber(s.sweepDeg)}°`;
    case 'polyline':
      return `${s.closed ? 'Closed polyline' : 'Polyline'} created – ${s.points.length} points`;
  }
}

interface Marker {
  id: ShapeId;
  kind: Constraint['kind'];
  status: ConstraintStatus;
  label: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const STATUS_TEXT: Record<ConstraintStatus, string> = {
  satisfied: 'satisfied',
  unsatisfied: 'NOT satisfied (conflict or edited geometry)',
  suppressed: 'suppressed (ignored)',
  broken: 'broken – refers to missing or unsupported geometry',
};

/** Screen-space marker boxes for constraints on visible geometry (stacked when they share an anchor). */
function layoutConstraintMarkers(doc: import('../model/types').DrawingDocument, t: ViewTransform): Marker[] {
  const out: Marker[] = [];
  const used = new Map<string, number>();
  for (const c of doc.constraints) {
    const refs = constraintShapeIds(c).map((id) => doc.shapes.find((x) => x.id === id));
    if (refs.some((r) => r && !isVisible(doc, r))) continue;
    const status = constraintStatus(doc, c);
    const value =
      c.kind === 'fixed-length' || c.kind === 'fixed-radius'
        ? ` ${formatNumber(c.value, 2)}`
        : c.kind === 'fixed-angle' || c.kind === 'angle'
          ? ` ${formatNumber(c.value, 2)}°`
          : '';
    const label = `${CONSTRAINT_GLYPHS[c.kind]}${value}${status === 'unsatisfied' || status === 'broken' ? ' !' : ''}`;
    const w = Math.max(18, label.length * 7 + 8);
    const h = 16;
    for (const a of constraintMarkerAnchors(doc, c)) {
      const p = worldToScreen(a, t);
      const key = `${Math.round(p.x / 4)},${Math.round(p.y / 4)}`;
      const dx = used.get(key) ?? 0;
      used.set(key, dx + w + 3);
      out.push({ id: c.id, kind: c.kind, status, label, title: `Driving constraint: ${c.kind} – ${STATUS_TEXT[status]}`, x: p.x + 8 + dx, y: p.y - 22, w, h });
    }
  }
  return out;
}
