import type { Dispatch } from 'react';
import { boundsHeight, boundsWidth } from '../geometry/bounds';
import { formatScale, pageLengthToWorld, worldLengthToPage, type DrawingScale } from '../geometry/scale';
import { formatNumber } from '../geometry/units';
import { vec } from '../geometry/vec';
import { getDimensions, getShapes, selectionBounds } from '../model/document';
import { CreateByNumbers } from './CreateByNumbers';
import { DimensionProperties, DimensionStyleFields } from './DimensionProperties';
import { ConstraintProperties, LayerAssign } from './ConstraintProperties';
import {
  moveBoundsTo,
  moveShape,
  rotateShape,
  setBoundsSize,
  setCircleRadius,
  setLineAngle,
  setLineLength,
  setRectRotation,
  setRectSize,
} from '../model/operations';
import { lineAngle, lineLength, polylineArea, polylineLength, shapeBounds } from '../model/shapes';
import { LINE_WEIGHTS, SHAPE_KIND_LABELS, TITLE_BLOCK_FIELDS, type Shape, type ShapeId, type ShapeStyle, type TitleBlock } from '../model/types';
import { todayIso } from '../model/titleBlock';
import { TextField } from './TextField';
import { NumberField } from './NumberField';
import type { EditorAction, EditorState } from './state/editorReducer';

export const PEN_COLOURS: { value: string; label: string }[] = [
  { value: 'bylayer', label: 'By layer' },
  { value: '#000000', label: 'Black' },
  { value: '#5f6368', label: 'Grey' },
  { value: '#c5221f', label: 'Red' },
  { value: '#1a73e8', label: 'Blue' },
  { value: '#188038', label: 'Green' },
  { value: '#e37400', label: 'Orange' },
];

/** Properties panel: exact numeric entry for the selected object(s), in drawing millimetres. */
export function PropertiesPanel({ state, dispatch, newId }: { state: EditorState; dispatch: Dispatch<EditorAction>; newId: () => ShapeId }) {
  const { doc, selection, tool } = state;
  const shapes = getShapes(doc, selection);
  const dims = getDimensions(doc, selection);
  const cons = doc.constraints.filter((c) => selection.includes(c.id));
  const update = (s: Shape[], message: string) => dispatch({ type: 'updateShapes', shapes: s, message });

  return (
    <aside className="properties" data-testid="properties-panel">
      <h2 className="panel-title">Properties</h2>
      {(tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arc' || tool === 'polygon') && (
        <CreateByNumbers key={tool} tool={tool} style={state.drawStyle} dispatch={dispatch} newId={newId} polygonSides={state.polygonSides} />
      )}
      {(tool === 'fillet' || tool === 'chamfer') && (
        <section className="panel-section" data-testid="corner-settings">
          <h3>{tool === 'fillet' ? 'Fillet' : 'Chamfer'}</h3>
          {tool === 'fillet' ? (
            <NumberField label="Radius" testId="fillet-radius" min={0} value={state.filletRadiusMm} onCommit={(mm) => dispatch({ type: 'setFilletRadius', mm })} />
          ) : (
            <NumberField label="Distance" testId="chamfer-distance" min={0} value={state.chamferDistanceMm} onCommit={(mm) => dispatch({ type: 'setChamferDistance', mm })} />
          )}
          <p className="hint">Drawing millimetres. 0 makes a sharp corner. Click the two lines on the parts to keep.</p>
        </section>
      )}
      {shapes.length === 0 && dims.length === 0 && cons.length === 0 && (
        <>
          <DocumentProperties state={state} />
          <TitleBlockProperties state={state} dispatch={dispatch} />
        </>
      )}
      {cons.length === 1 && shapes.length === 0 && dims.length === 0 && <ConstraintProperties c={cons[0]} doc={doc} dispatch={dispatch} />}
      {cons.length > 1 && shapes.length === 0 && dims.length === 0 && (
        <section className="panel-section" data-testid="props-multi-constraint">
          <h3>{cons.length} constraints selected</h3>
          <p className="hint">Press Delete to remove them. The geometry stays where it is.</p>
        </section>
      )}
      {(shapes.length > 0 || dims.length > 0) && <LayerAssign items={[...shapes, ...dims]} doc={doc} dispatch={dispatch} />}
      {shapes.length === 0 && dims.length === 1 && <DimensionProperties dim={dims[0]} doc={doc} dispatch={dispatch} />}
      {shapes.length === 0 && dims.length > 1 && (
        <>
          <section className="panel-section" data-testid="props-multi-dim">
            <h3>{dims.length} dimensions selected</h3>
            <p className="hint">Driven dimensions: values are measured from geometry.</p>
          </section>
          <DimensionStyleFields dims={dims} dispatch={dispatch} />
        </>
      )}
      {shapes.length === 1 && <SingleShapeProperties shape={shapes[0]} scale={doc.scale} update={update} />}
      {shapes.length > 1 && <MultiProperties state={state} shapes={shapes} update={update} />}
      {shapes.length > 0 && dims.length > 0 && <p className="hint">+ {dims.length} dimension{dims.length === 1 ? '' : 's'} in the selection</p>}
      {shapes.length > 0 && <StyleProperties shapes={shapes} update={update} />}
    </aside>
  );
}

function DocumentProperties({ state }: { state: EditorState }) {
  const { page, scale, shapes } = state.doc;
  return (
    <section className="panel-section">
      <h3>Drawing</h3>
      <dl className="info">
        <dt>Sheet</dt>
        <dd data-testid="doc-sheet">
          A3 landscape, {page.widthMm} × {page.heightMm} mm
        </dd>
        <dt>Scale</dt>
        <dd data-testid="doc-scale">{formatScale(scale)}</dd>
        <dt>Drawing area</dt>
        <dd data-testid="doc-area">
          {formatNumber(pageLengthToWorld(page.widthMm, scale))} × {formatNumber(pageLengthToWorld(page.heightMm, scale))} mm
        </dd>
        <dt>Objects</dt>
        <dd>{shapes.length}</dd>
        <dt>Origin</dt>
        <dd>Bottom-left of sheet, Y up</dd>
      </dl>
      <p className="hint">Select an object to edit its exact position and size. All values are real-world millimetres.</p>
    </section>
  );
}

type Update = (s: Shape[], message: string) => void;

function OnPaper({ label, value, scale }: { label: string; value: number; scale: DrawingScale }) {
  if (scale.paper === scale.real) return null;
  return (
    <div className="on-paper" data-testid="on-paper">
      {label} on paper at {formatScale(scale)}: {formatNumber(worldLengthToPage(value, scale))} mm
    </div>
  );
}

function SingleShapeProperties({ shape: s, scale, update }: { shape: Shape; scale: DrawingScale; update: Update }) {
  const title = SHAPE_KIND_LABELS[s.kind];
  const u = (next: Shape, what: string) => update([next], `${title}: ${what}`);
  return (
    <section className="panel-section" data-testid={`props-${s.kind}`}>
      <h3>{title}</h3>
      {s.kind === 'line' && (
        <>
          <div className="field-grid">
            <NumberField label="Start X" testId="prop-x1" value={s.start.x} onCommit={(v) => u({ ...s, start: vec(v, s.start.y) }, 'start X')} />
            <NumberField label="Start Y" testId="prop-y1" value={s.start.y} onCommit={(v) => u({ ...s, start: vec(s.start.x, v) }, 'start Y')} />
            <NumberField label="End X" testId="prop-x2" value={s.end.x} onCommit={(v) => u({ ...s, end: vec(v, s.end.y) }, 'end X')} />
            <NumberField label="End Y" testId="prop-y2" value={s.end.y} onCommit={(v) => u({ ...s, end: vec(s.end.x, v) }, 'end Y')} />
          </div>
          <NumberField label="Length" testId="prop-length" min={0} value={lineLength(s)} onCommit={(v) => u(setLineLength(s, v), 'length')} title="Keeps the start point and direction" />
          <NumberField label="Angle" testId="prop-angle" unit="°" value={lineAngle(s)} onCommit={(v) => u(setLineAngle(s, v), 'angle')} title="Degrees counter-clockwise from +X; keeps start point and length" />
          <OnPaper label="Length" value={lineLength(s)} scale={scale} />
        </>
      )}
      {s.kind === 'rect' && (
        <>
          <div className="field-grid">
            <NumberField label="X" testId="prop-x" value={s.origin.x} onCommit={(v) => u({ ...s, origin: vec(v, s.origin.y) }, 'X')} title="Base corner X" />
            <NumberField label="Y" testId="prop-y" value={s.origin.y} onCommit={(v) => u({ ...s, origin: vec(s.origin.x, v) }, 'Y')} title="Base corner Y" />
            <NumberField label="Width" testId="prop-width" min={0} value={s.width} onCommit={(v) => u(setRectSize(s, v, s.height), 'width')} />
            <NumberField label="Height" testId="prop-height" min={0} value={s.height} onCommit={(v) => u(setRectSize(s, s.width, v), 'height')} />
          </div>
          <NumberField label="Rotation" testId="prop-rotation" unit="°" value={s.rotationDeg} onCommit={(v) => u(setRectRotation(s, v), 'rotation')} title="Degrees counter-clockwise about the base corner (X, Y)" />
          <OnPaper label="Width" value={s.width} scale={scale} />
          <p className="hint">X, Y is the base corner; rotation is about this corner.</p>
        </>
      )}
      {s.kind === 'circle' && (
        <>
          <div className="field-grid">
            <NumberField label="Centre X" testId="prop-cx" value={s.center.x} onCommit={(v) => u({ ...s, center: vec(v, s.center.y) }, 'centre X')} />
            <NumberField label="Centre Y" testId="prop-cy" value={s.center.y} onCommit={(v) => u({ ...s, center: vec(s.center.x, v) }, 'centre Y')} />
            <NumberField label="Radius" testId="prop-radius" min={0} value={s.radius} onCommit={(v) => u(setCircleRadius(s, v), 'radius')} />
            <NumberField label="Diameter" testId="prop-diameter" min={0} value={s.radius * 2} onCommit={(v) => u(setCircleRadius(s, v / 2), 'diameter')} />
          </div>
          <OnPaper label="Diameter" value={s.radius * 2} scale={scale} />
        </>
      )}
      {s.kind === 'arc' && (
        <>
          <div className="field-grid">
            <NumberField label="Centre X" testId="prop-cx" value={s.center.x} onCommit={(v) => u({ ...s, center: vec(v, s.center.y) }, 'centre X')} />
            <NumberField label="Centre Y" testId="prop-cy" value={s.center.y} onCommit={(v) => u({ ...s, center: vec(s.center.x, v) }, 'centre Y')} />
            <NumberField label="Radius" testId="prop-radius" min={0.000001} value={s.radius} onCommit={(v) => u({ ...s, radius: v }, 'radius')} />
            <NumberField label="Sweep" testId="prop-sweep" unit="°" value={s.sweepDeg} onCommit={(v) => (v > 0 && v < 360 ? u({ ...s, sweepDeg: v }, 'sweep') : undefined)} title="Counter-clockwise from the start angle, 0°–360°" />
            <NumberField label="Start angle" testId="prop-start" unit="°" value={s.startDeg} onCommit={(v) => u({ ...s, startDeg: ((v % 360) + 360) % 360 }, 'start angle')} title="Rotates the arc (sweep kept)" />
            <NumberField label="End angle" testId="prop-end" unit="°" value={(s.startDeg + s.sweepDeg) % 360} onCommit={(v) => {
              const sw = (((v - s.startDeg) % 360) + 360) % 360;
              if (sw > 0) u({ ...s, sweepDeg: sw }, 'end angle');
            }} title="Changes the sweep (start kept)" />
          </div>
          <dl className="info">
            <dt>Arc length</dt>
            <dd data-testid="prop-arc-length">{formatNumber((s.radius * s.sweepDeg * Math.PI) / 180)} mm</dd>
          </dl>
          <OnPaper label="Radius" value={s.radius} scale={scale} />
        </>
      )}
      {s.kind === 'polyline' && <PolylineFields s={s} u={u} />}
    </section>
  );
}

function PolylineFields({ s, u }: { s: Extract<Shape, { kind: 'polyline' }>; u: (n: Shape, what: string) => void }) {
  const b = shapeBounds(s);
  return (
    <>
      <div className="field-grid">
        <NumberField label="X" testId="prop-x" value={b.minX} onCommit={(v) => u(moveBoundsTo(s, v, b.minY), 'X')} title="Left of bounding box" />
        <NumberField label="Y" testId="prop-y" value={b.minY} onCommit={(v) => u(moveBoundsTo(s, b.minX, v), 'Y')} title="Bottom of bounding box" />
        <NumberField label="Width" testId="prop-width" min={0} value={boundsWidth(b)} onCommit={(v) => u(setBoundsSize(s, v, boundsHeight(b)), 'width')} />
        <NumberField label="Height" testId="prop-height" min={0} value={boundsHeight(b)} onCommit={(v) => u(setBoundsSize(s, boundsWidth(b), v), 'height')} />
      </div>
      <RotateBy onRotate={(deg) => u(rotateShape(s, deg), `rotated ${formatNumber(deg)}°`)} />
      <label className="field" title="Closed: the last point joins back to the first (a polygon that can be filled or hatched)">
        <span className="field-label">Closed</span>
        <input
          type="checkbox"
          data-testid="prop-closed"
          checked={!!s.closed}
          disabled={!s.closed && s.points.length < 3}
          onChange={(e) => {
            const { closed: _c, ...open } = s;
            void _c;
            u(e.target.checked ? { ...s, closed: true } : open, e.target.checked ? 'closed' : 'opened');
          }}
        />
      </label>
      <dl className="info">
        <dt>Points</dt>
        <dd>{s.points.length}</dd>
        <dt>{s.closed ? 'Perimeter' : 'Path length'}</dt>
        <dd data-testid="prop-path-length">{formatNumber(polylineLength(s))} mm</dd>
        {s.closed && (
          <>
            <dt>Area</dt>
            <dd data-testid="prop-area">{formatNumber(polylineArea(s))} mm²</dd>
          </>
        )}
      </dl>
    </>
  );
}

/** Rotation entry for objects without a stored rotation: rotates by the entered angle about the centre. */
function RotateBy({ onRotate }: { onRotate: (deg: number) => void }) {
  return (
    <NumberField
      label="Rotate by"
      testId="prop-rotate-by"
      unit="°"
      value={0}
      resetAfterCommit
      onCommit={(v) => v !== 0 && onRotate(v)}
      title="Rotate by this many degrees (counter-clockwise) about the centre; press Enter to apply"
    />
  );
}

function MultiProperties({ state, shapes, update }: { state: EditorState; shapes: Shape[]; update: Update }) {
  const b = selectionBounds(state.doc, state.selection)!;
  const moveTo = (x: number, y: number) =>
    update(shapes.map((s) => moveShape(s, x - b.minX, y - b.minY)), 'Moved selection');
  const pivot = vec((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  return (
    <section className="panel-section" data-testid="props-multi">
      <h3>{shapes.length} objects selected</h3>
      <div className="field-grid">
        <NumberField label="X" testId="prop-x" value={b.minX} onCommit={(v) => moveTo(v, b.minY)} />
        <NumberField label="Y" testId="prop-y" value={b.minY} onCommit={(v) => moveTo(b.minX, v)} />
        <NumberField label="Width" testId="prop-width" value={boundsWidth(b)} readOnly />
        <NumberField label="Height" testId="prop-height" value={boundsHeight(b)} readOnly />
      </div>
      <RotateBy onRotate={(deg) => update(shapes.map((s) => rotateShape(s, deg, pivot)), `Rotated selection ${formatNumber(deg)}°`)} />
      <p className="hint">X, Y is the lower-left corner of the selection bounds.</p>
    </section>
  );
}

function StyleProperties({ shapes, update }: { shapes: Shape[]; update: Update }) {
  const first = shapes[0].style;
  const same = <K extends keyof ShapeStyle>(k: K) => shapes.every((s) => s.style[k] === first[k]);
  const setStyle = (patch: Partial<ShapeStyle>) =>
    update(shapes.map((s) => ({ ...s, style: { ...s.style, ...patch } })), 'Style changed');
  return (
    <section className="panel-section">
      <h3>Pen</h3>
      <label className="field">
        <span className="field-label">Colour</span>
        <select value={same('stroke') ? first.stroke : ''} onChange={(e) => setStyle({ stroke: e.target.value })}>
          {!same('stroke') && <option value="">(mixed)</option>}
          {PEN_COLOURS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field" title="Line weight on paper (does not change with drawing scale)">
        <span className="field-label">Weight</span>
        <select
          data-testid="prop-weight"
          value={same('strokeWidthMm') ? String(first.strokeWidthMm) : ''}
          onChange={(e) => setStyle({ strokeWidthMm: Number(e.target.value) })}
        >
          {!same('strokeWidthMm') && <option value="">(mixed)</option>}
          {LINE_WEIGHTS.map((w) => (
            <option key={w} value={String(w)}>
              {w.toFixed(2)} mm
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

/** Title block / drawing frame editor (shown when nothing is selected). */
function TitleBlockProperties({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const tb = state.doc.titleBlock;
  const set = (patch: Partial<TitleBlock>, message: string) =>
    dispatch({ type: 'commitDocument', doc: { ...state.doc, titleBlock: { ...tb, ...patch } }, message });
  return (
    <section className="panel-section" data-testid="title-block-panel">
      <h3>Title block</h3>
      <label className="field" title="Show the drawing frame and title block on the sheet, in exports and in PDFs">
        <span className="field-label">Show</span>
        <input
          type="checkbox"
          data-testid="title-block-visible"
          checked={tb.visible}
          onChange={(e) => set({ visible: e.target.checked, ...(e.target.checked && !tb.date ? { date: todayIso() } : {}) }, `Title block ${e.target.checked ? 'shown' : 'hidden'}`)}
        />
      </label>
      {tb.visible &&
        TITLE_BLOCK_FIELDS.map((f) => (
          <TextField key={f.key} label={f.label} testId={`tb-${f.key}`} value={tb[f.key]} maxLength={f.max} onCommit={(v) => set({ [f.key]: v } as Partial<TitleBlock>, `Title block: ${f.label.toLowerCase()} changed`)} />
        ))}
      {tb.visible && <p className="hint">Scale and sheet size are filled in automatically.</p>}
    </section>
  );
}
