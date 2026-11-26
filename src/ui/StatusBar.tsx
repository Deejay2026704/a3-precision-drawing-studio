import type { Dispatch } from 'react';
import { formatScale } from '../geometry/scale';
import { formatNumber } from '../geometry/units';
import type { Vec2 } from '../geometry/vec';
import { Icon } from './Icon';
import { ZoomSelect, type ViewCommands } from './Ribbon';
import { TOOL_LABELS, type EditorAction, type EditorState } from './state/editorReducer';
import { constraintStatuses } from '../model/constraints';
import { layerOf } from '../model/layers';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  cursor: Vec2 | null;
  feedback: string | null;
  zoom: number;
  view: ViewCommands;
}

export function StatusBar({ state, dispatch, cursor, feedback, zoom, view }: Props) {
  const n = state.selection.length;
  const v = state.view;
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span className="status-cell status-coords" data-testid="status-cursor" title="Cursor (snapped) position in drawing millimetres – origin bottom-left, Y up">
        X {cursor ? formatNumber(cursor.x, 2) : '—'} &nbsp; Y {cursor ? formatNumber(cursor.y, 2) : '—'} mm
      </span>
      <span className="status-cell status-feedback" data-testid="status-feedback" title="Live length / angle / size of the current operation">
        {feedback ?? ''}
      </span>
      <span className={`status-cell status-tool${state.tool !== 'select' ? ' active' : ''}`} data-testid="status-tool" title="Active tool (Esc returns to Select)">
        {TOOL_LABELS[state.tool]}
      </span>
      <span className="status-cell" data-testid="status-layer" title="Active layer: new objects are created here">
        Layer: {layerOf(state.doc, { layerId: state.activeLayerId }).name}
      </span>
      <span className="status-cell" data-testid="status-selection">
        {n === 0 ? 'No selection' : `${n} selected`}
      </span>
      <span className="status-cell status-message" data-testid="status-message">
        {state.message}
      </span>
      <ConstraintSummary state={state} />
      <button
        className={`status-toggle${v.objectSnap ? ' on' : ''}`}
        data-testid="status-osnap"
        title="Object snap on/off (F3). Choose individual snaps on the Draw ribbon."
        onClick={() => dispatch({ type: 'setView', view: { objectSnap: !v.objectSnap } })}
      >
        OSNAP
      </button>
      <button
        className={`status-toggle${v.snapEnabled ? ' on' : ''}`}
        data-testid="status-gridsnap"
        title={`Grid snap on/off (F9) – increment ${v.snapStepMm} mm`}
        onClick={() => dispatch({ type: 'setView', view: { snapEnabled: !v.snapEnabled } })}
      >
        GRID {v.snapStepMm}
      </button>
      <span className="status-cell" data-testid="status-scale">
        Scale {formatScale(state.doc.scale)}
      </span>
      <span className="status-cell">mm</span>
      <span className="status-cell status-zoom">
        <button className="icon-btn" onClick={view.zoomOut} title="Zoom out">
          <Icon name="zoomOut" size={14} />
        </button>
        <ZoomSelect zoom={zoom} onChange={view.zoomTo} />
        <button className="icon-btn" onClick={view.zoomIn} title="Zoom in">
          <Icon name="zoomIn" size={14} />
        </button>
        <button className="icon-btn" onClick={view.fitPage} title="Fit page" data-testid="status-fit">
          <Icon name="fit" size={14} />
        </button>
      </span>
    </footer>
  );
}

/** Count of driving constraints by status; red when any is not satisfied. */
function ConstraintSummary({ state }: { state: EditorState }) {
  if (state.doc.constraints.length === 0) return null;
  const st = [...constraintStatuses(state.doc).values()];
  const ok = st.filter((x) => x === 'satisfied').length;
  const bad = st.filter((x) => x === 'unsatisfied' || x === 'broken').length;
  const off = st.filter((x) => x === 'suppressed').length;
  return (
    <span
      className={`status-cell status-constraints${bad ? ' bad' : ''}`}
      data-testid="status-constraints"
      data-unsatisfied={bad}
      title={`Driving constraints: ${ok} satisfied, ${bad} not satisfied or broken, ${off} suppressed`}
    >
      Constraints {ok}✓{bad ? ` ${bad}⚠` : ''}{off ? ` ${off} off` : ''}
    </span>
  );
}
