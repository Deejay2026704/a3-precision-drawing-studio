import { formatScale } from '../geometry/scale';
import { formatNumber } from '../geometry/units';
import type { Vec2 } from '../geometry/vec';
import { Icon } from './Icon';
import { ZoomSelect, type ViewCommands } from './Ribbon';
import { TOOL_LABELS, type EditorState } from './state/editorReducer';

export function StatusBar({ state, cursor, zoom, view }: { state: EditorState; cursor: Vec2 | null; zoom: number; view: ViewCommands }) {
  const n = state.selection.length;
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span className="status-cell status-coords" data-testid="status-cursor" title="Cursor position in drawing millimetres (origin bottom-left, Y up)">
        X {cursor ? formatNumber(cursor.x, 2) : '—'} &nbsp; Y {cursor ? formatNumber(cursor.y, 2) : '—'} mm
      </span>
      <span className="status-cell">{TOOL_LABELS[state.tool]}</span>
      <span className="status-cell" data-testid="status-selection">
        {n === 0 ? 'No selection' : `${n} selected`}
      </span>
      <span className="status-cell status-message" data-testid="status-message">
        {state.message}
      </span>
      <span className="status-cell">A3 420 × 297 mm</span>
      <span className="status-cell" data-testid="status-scale">
        Scale {formatScale(state.doc.scale)}
      </span>
      <span className="status-cell">Units: mm</span>
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
