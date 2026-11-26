import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent } from 'react';
import { angleBetweenPoints, polarPoint, snapAngle } from '../geometry/angles';
import { boundsFromCorners } from '../geometry/bounds';
import { screenLengthToWorld, screenToWorld, worldToScreen, type ViewTransform } from '../geometry/coords';
import { formatNumber, snapValue } from '../geometry/units';
import { panBy, zoomAt, type Viewport } from '../geometry/viewport';
import { distance, sub, vec, type Vec2 } from '../geometry/vec';
import { getShapes } from '../model/document';
import { applyHandleDrag, getSelectionFrame, type HandleId, type SelectionFrame } from '../model/handles';
import { hitTest, shapesInsideBounds } from '../model/hitTest';
import { moveShape } from '../model/operations';
import { createCircle, createLine, createPolyline, createRectFromCorners, lineLength } from '../model/shapes';
import type { Shape, ShapeId } from '../model/types';
import { PageView } from '../render/PageView';
import { HorizontalRuler, RULER_SIZE, VerticalRuler } from '../render/Rulers';
import { HANDLE_SIZE_PX, ROTATE_HANDLE_OFFSET_PX, SelectionOverlay } from '../render/SelectionOverlay';
import { ShapeView } from '../render/ShapeView';
import type { EditorAction, EditorState } from './state/editorReducer';

const HIT_TOLERANCE_PX = 6;
const DRAG_THRESHOLD_PX = 3;
const FREEHAND_MIN_STEP_PX = 2;

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startViewport: Viewport }
  | { kind: 'move'; startScreen: Vec2; startWorld: Vec2; originals: Shape[]; active: boolean }
  | { kind: 'handle'; handle: HandleId; frame: SelectionFrame; startWorld: Vec2; originals: Shape[] }
  | { kind: 'marquee'; startScreen: Vec2; additive: boolean }
  | { kind: 'draw'; startWorld: Vec2; points: Vec2[]; lastScreen: Vec2 };

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  viewport: Viewport;
  setViewport: (update: Viewport | ((vp: Viewport) => Viewport)) => void;
  onResize: (width: number, height: number) => void;
  cursorWorld: Vec2 | null;
  onCursor: (p: Vec2 | null) => void;
  newId: () => ShapeId;
}

/**
 * Workspace: rulers + SVG canvas. Converts pointer input from screen px to world mm
 * exactly once, then edits the model through pure model operations.
 */
export function DrawingCanvas({ state, dispatch, viewport, setViewport, onResize, cursorWorld, onCursor, newId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string>('default');
  const [panning, setPanning] = useState(false);

  const { doc, selection, tool, view } = state;
  const transform: ViewTransform = useMemo(() => ({ scale: doc.scale, viewport }), [doc.scale, viewport]);
  const selectedShapes = useMemo(() => getShapes(doc, selection), [doc, selection]);
  const frame = useMemo(
    () => getSelectionFrame(selectedShapes, screenLengthToWorld(ROTATE_HANDLE_OFFSET_PX, transform)),
    [selectedShapes, transform],
  );

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

  // ---- Space (pan) and Escape (cancel drag) ----
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceDown.current = true;
        e.preventDefault();
      }
      if (e.key === 'Escape' && dragRef.current) {
        const d = dragRef.current;
        if (d.kind === 'move' || d.kind === 'handle') dispatch({ type: 'cancelEdit' });
        dragRef.current = null;
        setDraft(null);
        setMarquee(null);
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
  }, [dispatch]);

  // Leaving a draw tool discards any unfinished draft.
  useEffect(() => setDraft(null), [tool]);

  const localPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };
  const snap = (p: Vec2): Vec2 =>
    view.snapEnabled ? vec(snapValue(p.x, view.snapStepMm), snapValue(p.y, view.snapStepMm)) : p;

  const findHandle = (sp: Vec2): HandleId | null => {
    if (!frame || tool !== 'select') return null;
    for (const h of frame.handles) {
      const hp = worldToScreen(h.position, transform);
      if (Math.abs(hp.x - sp.x) <= HANDLE_SIZE_PX / 2 + 3 && Math.abs(hp.y - sp.y) <= HANDLE_SIZE_PX / 2 + 3) return h.id;
    }
    return null;
  };

  const buildDraft = (d: Extract<Drag, { kind: 'draw' }>, current: Vec2, constrain: boolean): Shape | null => {
    const style = state.drawStyle;
    const a = d.startWorld;
    switch (tool) {
      case 'line': {
        let b = snap(current);
        if (constrain) b = polarPoint(a, distance(a, b), snapAngle(angleBetweenPoints(a, b), 15));
        return createLine('draft', a, b, style);
      }
      case 'rect': {
        let b = snap(current);
        if (constrain) {
          const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          b = vec(a.x + Math.sign(b.x - a.x || 1) * side, a.y + Math.sign(b.y - a.y || 1) * side);
        }
        return createRectFromCorners('draft', a, b, style);
      }
      case 'circle':
        return createCircle('draft', a, distance(a, snap(current)), style);
      case 'freehand':
        return createPolyline('draft', d.points, style);
      default:
        return null;
    }
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

    if (tool === 'select') {
      const handle = findHandle(sp);
      if (handle && frame) {
        dispatch({ type: 'beginEdit' });
        dragRef.current = { kind: 'handle', handle, frame, startWorld: wp, originals: selectedShapes };
        return;
      }
      const hit = hitTest(doc.shapes, wp, screenLengthToWorld(HIT_TOLERANCE_PX, transform));
      if (hit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          dispatch({ type: 'toggleSelection', id: hit.id });
          return;
        }
        const ids = selection.includes(hit.id) ? selection : [hit.id];
        if (!selection.includes(hit.id)) dispatch({ type: 'setSelection', ids });
        dispatch({ type: 'beginEdit' });
        dragRef.current = { kind: 'move', startScreen: sp, startWorld: wp, originals: getShapes(doc, ids), active: false };
        return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) dispatch({ type: 'setSelection', ids: [] });
      dragRef.current = { kind: 'marquee', startScreen: sp, additive };
      setMarquee({ a: sp, b: sp });
      return;
    }

    // Drawing tools
    const start = tool === 'freehand' ? wp : snap(wp);
    const d: Drag = { kind: 'draw', startWorld: start, points: [start], lastScreen: sp };
    dragRef.current = d;
    setDraft(buildDraft(d, start, e.shiftKey));
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const sp = localPoint(e);
    const wp = screenToWorld(sp, transform);
    onCursor(tool === 'freehand' ? wp : snap(wp));
    const d = dragRef.current;

    if (!d) {
      if (tool === 'select') {
        const h = findHandle(sp);
        const overShape = !h && hitTest(doc.shapes, wp, screenLengthToWorld(HIT_TOLERANCE_PX, transform));
        setHoverCursor(h === 'rotate' ? 'grab' : h ? 'crosshair' : overShape ? 'move' : 'default');
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
        let delta = sub(wp, d.startWorld);
        if (view.snapEnabled) delta = vec(snapValue(delta.x, view.snapStepMm), snapValue(delta.y, view.snapStepMm));
        if (e.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? vec(delta.x, 0) : vec(0, delta.y);
        dispatch({ type: 'previewShapes', shapes: d.originals.map((s) => moveShape(s, delta.x, delta.y)) });
        break;
      }
      case 'handle':
        dispatch({
          type: 'previewShapes',
          shapes: applyHandleDrag(d.originals, d.frame, d.handle, d.startWorld, wp, {
            constrain: e.shiftKey,
            snapPoint: view.snapEnabled ? snap : undefined,
          }),
        });
        break;
      case 'marquee':
        setMarquee({ a: d.startScreen, b: sp });
        break;
      case 'draw':
        if (tool === 'freehand' && distance(sp, d.lastScreen) >= FREEHAND_MIN_STEP_PX) {
          d.points = [...d.points, wp];
          d.lastScreen = sp;
        }
        setDraft(buildDraft(d, wp, e.shiftKey));
        break;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const sp = localPoint(e);
    switch (d.kind) {
      case 'pan':
        setPanning(false);
        break;
      case 'move':
        dispatch({ type: 'endEdit', message: `Moved ${d.originals.length} object${d.originals.length === 1 ? '' : 's'}` });
        break;
      case 'handle':
        dispatch({ type: 'endEdit', message: d.handle === 'rotate' ? 'Rotated selection' : 'Resized selection' });
        break;
      case 'marquee': {
        setMarquee(null);
        if (distance(sp, d.startScreen) < DRAG_THRESHOLD_PX) break;
        const win = boundsFromCorners(screenToWorld(d.startScreen, transform), screenToWorld(sp, transform));
        const inside = shapesInsideBounds(doc.shapes, win);
        dispatch({ type: 'setSelection', ids: d.additive ? [...new Set([...selection, ...inside])] : inside });
        break;
      }
      case 'draw': {
        const shape = buildDraft(d, screenToWorld(sp, transform), e.shiftKey);
        setDraft(null);
        if (!shape || !isMeaningful(shape)) break;
        const created = { ...shape, id: newId() };
        dispatch({ type: 'addShapes', shapes: [created], message: describeCreated(created) });
        break;
      }
    }
  };

  // ---------------- rendering ----------------

  const cursorScreen = cursorWorld ? worldToScreen(cursorWorld, transform) : null;
  const cursor = panning ? 'grabbing' : tool === 'select' ? hoverCursor : 'crosshair';
  const selectedSet = new Set(selection);

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${RULER_SIZE}px 1fr`, gridTemplateRows: `${RULER_SIZE}px 1fr` }}>
      <div className="ruler-corner" title="Units: millimetres (drawing units)">mm</div>
      <HorizontalRuler transform={transform} width={size.width} cursorX={cursorScreen?.x ?? null} />
      <VerticalRuler transform={transform} height={size.height} cursorY={cursorScreen?.y ?? null} />
      <div className="canvas-host" ref={hostRef}>
        <svg
          ref={svgRef}
          className="canvas"
          data-testid="canvas"
          width={size.width}
          height={size.height}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => !dragRef.current && onCursor(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <PageView page={doc.page} transform={transform} showGrid={view.showGrid} />
          <g data-testid="shapes">
            {doc.shapes.map((s) => (
              <ShapeView key={s.id} shape={s} transform={transform} stroke={selectedSet.has(s.id) && tool !== 'select' ? '#1a73e8' : undefined} />
            ))}
          </g>
          {draft && <ShapeView shape={draft} transform={transform} stroke="#1a73e8" />}
          {frame && <SelectionOverlay frame={frame} transform={transform} interactive={tool === 'select'} />}
          {marquee && (
            <rect
              className="marquee"
              x={Math.min(marquee.a.x, marquee.b.x)}
              y={Math.min(marquee.a.y, marquee.b.y)}
              width={Math.abs(marquee.b.x - marquee.a.x)}
              height={Math.abs(marquee.b.y - marquee.a.y)}
            />
          )}
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
    case 'polyline':
      return s.points.length >= 2;
  }
}

function describeCreated(s: Shape): string {
  switch (s.kind) {
    case 'line':
      return `Line created – length ${formatNumber(lineLength(s))} mm`;
    case 'rect':
      return `Rectangle created – ${formatNumber(s.width)} × ${formatNumber(s.height)} mm`;
    case 'circle':
      return `Circle created – radius ${formatNumber(s.radius)} mm`;
    case 'polyline':
      return `Freehand polyline created – ${s.points.length} points`;
  }
}
