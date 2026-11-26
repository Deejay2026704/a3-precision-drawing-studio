import type { Dispatch, ReactNode } from 'react';
import { ZOOM_PRESETS } from '../geometry/viewport';
import { LINE_WEIGHTS } from '../model/types';
import { Icon } from './Icon';
import { PEN_COLOURS } from './PropertiesPanel';
import { ScaleSelector } from './ScaleSelector';
import type { EditorAction, EditorState, ToolId } from './state/editorReducer';

export type RibbonTab = 'home' | 'draw' | 'view';

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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-title">{title}</div>
    </div>
  );
}

function Big({ icon, label, onClick, active, disabled, testId, title }: { icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; testId?: string; title?: string }) {
  return (
    <button className={`ribbon-btn${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} data-testid={testId} title={title ?? label} aria-pressed={active}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}

interface Props {
  tab: RibbonTab;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  zoom: number;
  view: ViewCommands;
  edit: EditCommands;
}

export function Ribbon({ tab, state, dispatch, zoom, view, edit }: Props) {
  const tool = (t: ToolId, icon: string, label: string, key: string) => (
    <Big icon={icon} label={label} active={state.tool === t} onClick={() => dispatch({ type: 'setTool', tool: t })} testId={`tool-${t}`} title={`${label} (${key})`} />
  );
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
          <Group title="Snap">
            <Big icon="snap" label="Snap" active={state.view.snapEnabled} onClick={() => dispatch({ type: 'setView', view: { snapEnabled: !state.view.snapEnabled } })} testId="cmd-snap" title="Snap points to increment" />
            <div className="ribbon-stack">
              <label className="ribbon-field" title="Snap increment in drawing millimetres">
                Step
                <select data-testid="snap-step" value={String(state.view.snapStepMm)} onChange={(e) => dispatch({ type: 'setView', view: { snapStepMm: Number(e.target.value) } })}>
                  {SNAP_STEPS.map((s) => (
                    <option key={s} value={String(s)}>
                      {s} mm
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Group>
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
            <Big icon="grid" label="Grid" active={state.view.showGrid} onClick={() => dispatch({ type: 'setView', view: { showGrid: !state.view.showGrid } })} testId="cmd-grid" title="10 mm paper grid" />
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
