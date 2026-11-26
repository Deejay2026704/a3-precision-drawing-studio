import type { Dispatch, ReactNode } from 'react';
import { ZOOM_PRESETS } from '../geometry/viewport';
import { OBJECT_SNAP_KINDS, SNAP_LABELS } from '../model/snap';
import { LINE_WEIGHTS, type ArrowheadStyle } from '../model/types';
import { NumberField } from './NumberField';
import { CONSTRAINT_GLYPHS, constraintFromSelection } from '../model/constraints';
import { getShapes } from '../model/document';
import { CONSTRAINT_LABELS, type ConstraintKind } from '../model/types';
import { Icon } from './Icon';
import { PEN_COLOURS } from './PropertiesPanel';
import { ScaleSelector } from './ScaleSelector';
import type { EditorAction, EditorState, ToolId } from './state/editorReducer';

export type RibbonTab = 'home' | 'draw' | 'annotate' | 'constrain' | 'view';

export interface ViewCommands {
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(zoom: number): void;
  fitPage(): void;
}

export interface EditCommands {
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  duplicate(): void;
  selectAll(): void;
}

const SNAP_STEPS = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
export const GRID_SPACINGS = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000];
export const TEXT_HEIGHTS = [1.8, 2.5, 3.5, 5, 7];
export const ARROW_SIZES = [1.5, 2, 2.5, 3, 3.5, 5];
export const ARROWHEADS: { value: ArrowheadStyle; label: string }[] = [
  { value: 'closed', label: 'Closed' },
  { value: 'open', label: 'Open' },
  { value: 'tick', label: 'Tick' },
  { value: 'dot', label: 'Dot' },
  { value: 'none', label: 'None' },
];

const SNAP_TIPS: Record<string, string> = {
  endpoint: 'Ends of lines, corners of rectangles, polyline vertices',
  midpoint: 'Midpoints of lines, rectangle edges and polyline segments',
  center: 'Centres of circles and rectangles',
  intersection: 'Where two objects cross',
  perpendicular: 'Foot of the perpendicular from the previous point',
  tangent: 'Tangent point on a circle from the previous point',
  nearest: 'Nearest point on any object',
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-title">{title}</div>
    </div>
  );
}

function Big({ icon, glyph, label, onClick, active, disabled, testId, title }: { icon: string; glyph?: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; testId?: string; title?: string }) {
  return (
    <button className={`ribbon-btn${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} data-testid={testId} title={title ?? label} aria-pressed={active} data-active={active ? 'true' : undefined}>
      {glyph ? <span className="ribbon-glyph">{glyph}</span> : <Icon name={icon} size={22} />}
      <span>{label}</span>
    </button>
  );
}

const SELECTION_CONSTRAINTS: { kind: ConstraintKind; tip: string }[] = [
  { kind: 'horizontal', tip: 'Make the selected line horizontal' },
  { kind: 'vertical', tip: 'Make the selected line vertical' },
  { kind: 'parallel', tip: 'Make the two selected lines parallel' },
  { kind: 'perpendicular', tip: 'Make the two selected lines perpendicular' },
  { kind: 'tangent', tip: 'Make the selected line and circle (or two circles) tangent' },
  { kind: 'equal-length', tip: 'Make the two selected lines equal in length' },
  { kind: 'fixed-length', tip: 'Fix the selected line at its current length (editable in Properties)' },
  { kind: 'fixed-angle', tip: 'Fix the selected line at its current angle (editable in Properties)' },
];

interface Props {
  tab: RibbonTab;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  zoom: number;
  view: ViewCommands;
  edit: EditCommands;
  constrain: (kind: ConstraintKind) => void;
}

export function Ribbon({ tab, state, dispatch, zoom, view, edit, constrain }: Props) {
  const tool = (t: ToolId, icon: string, label: string, key: string, tip = '') => (
    <Big
      icon={icon}
      label={label}
      active={state.tool === t}
      onClick={() => dispatch({ type: 'setTool', tool: t })}
      testId={`tool-${t}`}
      title={`${label}${key ? ` (${key})` : ''}${tip ? ` – ${tip}` : ''}`}
    />
  );
  const v = state.view;
  const ds = state.dimStyle;
  const hasSel = state.selection.length > 0;

  return (
    <div className="ribbon" data-testid={`ribbon-${tab}`}>
      {tab === 'home' && (
        <>
          <Group title="History">
            <Big icon="undo" label="Undo" onClick={edit.undo} disabled={state.past.length === 0} testId="cmd-undo" title="Undo (Ctrl+Z)" />
            <Big icon="redo" label="Redo" onClick={edit.redo} disabled={state.future.length === 0} testId="cmd-redo" title="Redo (Ctrl+Y)" />
          </Group>
          <Group title="Selection">
            {tool('select', 'select', 'Select', 'V')}
            <Big icon="selectAll" label="Select All" onClick={edit.selectAll} testId="cmd-select-all" title="Select all (Ctrl+A)" />
          </Group>
          <Group title="Edit">
            <Big icon="duplicate" label="Duplicate" onClick={edit.duplicate} disabled={!hasSel} testId="cmd-duplicate" title="Duplicate (Ctrl+D)" />
            <Big icon="delete" label="Delete" onClick={edit.deleteSelection} disabled={!hasSel} testId="cmd-delete" title="Delete (Del)" />
          </Group>
          <Group title="Drawing Scale">
            <div className="ribbon-stack">
              <ScaleSelector scale={state.doc.scale} onChange={(scale) => dispatch({ type: 'setScale', scale })} />
              <span className="ribbon-note">paper : real</span>
            </div>
          </Group>
        </>
      )}
      {tab === 'draw' && (
        <>
          <Group title="Tools">
            {tool('select', 'select', 'Select', 'V')}
            {tool('line', 'line', 'Line', 'L')}
            {tool('rect', 'rect', 'Rectangle', 'R')}
            {tool('circle', 'circle', 'Circle', 'C')}
            {tool('freehand', 'freehand', 'Freehand', 'F')}
          </Group>
          <Group title="Pen (new objects)">
            <div className="ribbon-stack">
              <label className="ribbon-field">
                Colour
                <select value={state.drawStyle.stroke} onChange={(e) => dispatch({ type: 'setDrawStyle', style: { stroke: e.target.value } })}>
                  {PEN_COLOURS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ribbon-field" title="Line weight on paper">
                Weight
                <select value={String(state.drawStyle.strokeWidthMm)} onChange={(e) => dispatch({ type: 'setDrawStyle', style: { strokeWidthMm: Number(e.target.value) } })}>
                  {LINE_WEIGHTS.map((w) => (
                    <option key={w} value={String(w)}>
                      {w.toFixed(2)} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Group>
          <Group title="Modify">
            {tool('trim', 'trim', 'Trim', 'T', 'click the part of a line to remove, between crossing objects')}
            {tool('extend', 'extend', 'Extend', 'E', 'click near a line end to extend it to the next object')}
            {tool('offset', 'offset', 'Offset', 'O', 'click an object, then the side: creates a parallel copy')}
            {tool('mirror', 'mirror', 'Mirror', 'M', 'select objects, then click two points on the mirror line')}
            <div className="ribbon-stack">
              <div className="ribbon-number" title="Offset distance in drawing millimetres">
                <NumberField label="Offset" testId="offset-distance" min={0.000001} value={state.offsetDistanceMm} onCommit={(mm) => dispatch({ type: 'setOffsetDistance', mm })} />
              </div>
              <label className="ribbon-field" title="Mirror makes a copy (on) or moves the originals (off)">
                <input type="checkbox" data-testid="mirror-keep" checked={state.mirrorKeepSource} onChange={(e) => dispatch({ type: 'setMirrorKeepSource', keep: e.target.checked })} />
                Mirror keeps source
              </label>
            </div>
          </Group>
          <Group title="Snap">
            <Big icon="snap" label="Object Snap" active={v.objectSnap} onClick={() => dispatch({ type: 'setView', view: { objectSnap: !v.objectSnap } })} testId="cmd-osnap" title="Object snap on/off (F3)" />
            <div className="osnap-grid">
              {OBJECT_SNAP_KINDS.map((k) => (
                <label key={k} className={`osnap-item${v.objectSnap ? '' : ' disabled'}`} title={SNAP_TIPS[k]}>
                  <input
                    type="checkbox"
                    data-testid={`osnap-${k}`}
                    checked={v.osnap[k]}
                    onChange={(e) => dispatch({ type: 'setView', view: { osnap: { ...v.osnap, [k]: e.target.checked } } })}
                  />
                  {SNAP_LABELS[k]}
                </label>
              ))}
            </div>
            <Big icon="grid" label="Grid Snap" active={v.snapEnabled} onClick={() => dispatch({ type: 'setView', view: { snapEnabled: !v.snapEnabled } })} testId="cmd-snap" title="Snap to the grid increment when no object snap applies (F9)" />
            <div className="ribbon-stack">
              <label className="ribbon-field" title="Grid snap increment in drawing millimetres">
                Step
                <select data-testid="snap-step" value={String(v.snapStepMm)} onChange={(e) => dispatch({ type: 'setView', view: { snapStepMm: Number(e.target.value) } })}>
                  {SNAP_STEPS.map((st) => (
                    <option key={st} value={String(st)}>
                      {st} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Group>
        </>
      )}
      {tab === 'annotate' && (
        <>
          <Group title="Dimensions">
            {tool('dim-aligned', 'dimAligned', 'Aligned', 'D', 'true distance between two points')}
            {tool('dim-horizontal', 'dimHorizontal', 'Horizontal', '', 'X distance between two points')}
            {tool('dim-vertical', 'dimVertical', 'Vertical', '', 'Y distance between two points')}
            {tool('dim-angular', 'dimAngular', 'Angular', '', 'angle between two lines')}
            {tool('dim-radius', 'dimRadius', 'Radius', '', 'radius of a circle')}
            {tool('dim-diameter', 'dimDiameter', 'Diameter', '', 'diameter of a circle')}
          </Group>
          <Group title="Dimension Style (new dimensions)">
            <div className="ribbon-stack">
              <label className="ribbon-field" title="Decimal places shown">
                Precision
                <select data-testid="dim-decimals" value={String(ds.decimals)} onChange={(e) => dispatch({ type: 'setDimStyle', style: { decimals: Number(e.target.value) } })}>
                  {[0, 1, 2, 3, 4].map((d) => (
                    <option key={d} value={String(d)}>
                      {d === 0 ? '0' : `0.${'0'.repeat(d)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ribbon-field" title="Text height on paper">
                Text
                <select data-testid="dim-text-height" value={String(ds.textHeightMm)} onChange={(e) => dispatch({ type: 'setDimStyle', style: { textHeightMm: Number(e.target.value) } })}>
                  {TEXT_HEIGHTS.map((h) => (
                    <option key={h} value={String(h)}>
                      {h} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ribbon-stack">
              <label className="ribbon-field" title="Arrowhead style">
                Arrows
                <select value={ds.arrowhead} onChange={(e) => dispatch({ type: 'setDimStyle', style: { arrowhead: e.target.value as ArrowheadStyle } })}>
                  {ARROWHEADS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ribbon-field" title="Show extension lines">
                <input type="checkbox" checked={ds.showExtensionLines} onChange={(e) => dispatch({ type: 'setDimStyle', style: { showExtensionLines: e.target.checked } })} />
                Extension lines
              </label>
            </div>
            <span className="ribbon-note driven-note" title="Dimensions measure geometry and update automatically. They do not drive geometry.">Driven (measured)</span>
          </Group>
        </>
      )}
      {tab === 'constrain' && (
        <>
          <Group title="Driving constraints (from selection)">
            {SELECTION_CONSTRAINTS.map(({ kind, tip }) => {
              const r = constraintFromSelection(kind, getShapes(state.doc, state.selection), 'probe');
              const why = typeof r === 'string' ? r : '';
              return (
                <Big
                  key={kind}
                  icon=""
                  glyph={CONSTRAINT_GLYPHS[kind]}
                  label={CONSTRAINT_LABELS[kind]}
                  onClick={() => constrain(kind)}
                  disabled={!!why}
                  testId={`con-${kind}`}
                  title={`${CONSTRAINT_LABELS[kind]} – ${tip}${why ? ` (${why})` : ''}`}
                />
              );
            })}
          </Group>
          <Group title="Driving constraints (pick points)">
            <Big icon="" glyph={CONSTRAINT_GLYPHS.coincident} label="Coincident" active={state.tool === 'con-coincident'} onClick={() => dispatch({ type: 'setTool', tool: 'con-coincident' })} testId="tool-con-coincident" title="Coincident – click two points (line ends/midpoints, circle centres) to join them" />
            <Big icon="" glyph={CONSTRAINT_GLYPHS['fixed-position']} label="Fix Position" active={state.tool === 'con-fixed-position'} onClick={() => dispatch({ type: 'setTool', tool: 'con-fixed-position' })} testId="tool-con-fixed-position" title="Fixed position – click a line end/midpoint or circle centre to pin it where it is" />
          </Group>
          <div className="ribbon-group">
            <div className="ribbon-group-body">
              <span className="ribbon-note constraint-note" title="Driving constraints CONTROL geometry. Dimensions (Annotate tab) are reference dimensions: they only report measurements.">
                Constraints control geometry.
                <br />
                Lines and circles only.
              </span>
            </div>
            <div className="ribbon-group-title">About</div>
          </div>
        </>
      )}
      {tab === 'view' && (
        <>
          <Group title="Zoom">
            <Big icon="zoomIn" label="Zoom In" onClick={view.zoomIn} testId="cmd-zoom-in" />
            <Big icon="zoomOut" label="Zoom Out" onClick={view.zoomOut} testId="cmd-zoom-out" />
            <Big icon="actual" label="100 %" onClick={() => view.zoomTo(1)} testId="cmd-zoom-100" title="True paper size (96 dpi)" />
            <Big icon="fit" label="Fit Page" onClick={view.fitPage} testId="cmd-fit-page" />
            <div className="ribbon-stack">
              <ZoomSelect zoom={zoom} onChange={view.zoomTo} />
            </div>
          </Group>
          <Group title="Show">
            <Big icon="grid" label="Grid" active={state.view.showGrid} onClick={() => dispatch({ type: 'setView', view: { showGrid: !state.view.showGrid } })} testId="cmd-grid" title="Show the grid" />
            <div className="ribbon-stack">
              <label className="ribbon-field" title="Grid spacing in drawing millimetres (coarsened automatically when too dense on screen)">
                Spacing
                <select data-testid="grid-spacing" value={String(state.view.gridSpacingMm)} onChange={(e) => dispatch({ type: 'setView', view: { gridSpacingMm: Number(e.target.value) } })}>
                  {GRID_SPACINGS.map((g) => (
                    <option key={g} value={String(g)}>
                      {g} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Group>
          <Group title="Drawing Scale">
            <div className="ribbon-stack">
              <ScaleSelector scale={state.doc.scale} onChange={(scale) => dispatch({ type: 'setScale', scale })} />
              <span className="ribbon-note">paper : real</span>
            </div>
          </Group>
        </>
      )}
    </div>
  );
}

export function ZoomSelect({ zoom, onChange }: { zoom: number; onChange: (z: number) => void }) {
  const pct = Math.round(zoom * 100);
  const isPreset = ZOOM_PRESETS.some((z) => Math.round(z * 100) === pct);
  return (
    <select className="zoom-select" data-testid="zoom-select" value={isPreset ? String(pct) : 'current'} onChange={(e) => onChange(Number(e.target.value) / 100)}>
      {!isPreset && <option value="current">{pct} %</option>}
      {ZOOM_PRESETS.map((z) => (
        <option key={z} value={String(Math.round(z * 100))}>
          {Math.round(z * 100)} %
        </option>
      ))}
    </select>
  );
}
