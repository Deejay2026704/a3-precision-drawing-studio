import { useState, type Dispatch } from 'react';
import { vec } from '../geometry/vec';
import { createCircle, createLine, createRect } from '../model/shapes';
import { polarPoint } from '../geometry/angles';
import type { Shape, ShapeId, ShapeStyle } from '../model/types';
import { describeCreated } from './DrawingCanvas';
import { NumberField } from './NumberField';
import type { EditorAction } from './state/editorReducer';

/**
 * Exact numeric creation for the active draw tool: type the values, press Create.
 * Line: start, length, angle. Rectangle: corner, width, height, rotation. Circle: centre, radius/diameter.
 */
export function CreateByNumbers({ tool, style, dispatch, newId }: { tool: 'line' | 'rect' | 'circle'; style: ShapeStyle; dispatch: Dispatch<EditorAction>; newId: () => ShapeId }) {
  const [v, setV] = useState({ x: 0, y: 0, length: 100, angle: 0, width: 100, height: 50, rotation: 0, radius: 25 });
  const set = (k: keyof typeof v) => (n: number) => setV((o) => ({ ...o, [k]: n }));

  const create = () => {
    let shape: Shape;
    if (tool === 'line') {
      if (!(v.length > 0)) return dispatch({ type: 'setMessage', message: '⚠ Length must be greater than zero' });
      shape = createLine(newId(), vec(v.x, v.y), polarPoint(vec(v.x, v.y), v.length, v.angle), style);
    } else if (tool === 'rect') {
      if (!(v.width > 0 && v.height > 0)) return dispatch({ type: 'setMessage', message: '⚠ Width and height must be greater than zero' });
      shape = createRect(newId(), vec(v.x, v.y), v.width, v.height, v.rotation, style);
    } else {
      if (!(v.radius > 0)) return dispatch({ type: 'setMessage', message: '⚠ Radius must be greater than zero' });
      shape = createCircle(newId(), vec(v.x, v.y), v.radius, style);
    }
    dispatch({ type: 'addShapes', shapes: [shape], message: describeCreated(shape) });
  };

  const title = tool === 'line' ? 'New line' : tool === 'rect' ? 'New rectangle' : 'New circle';
  return (
    <section className="panel-section create-section" data-testid={`create-${tool}`}>
      <h3>{title} by numbers</h3>
      <div className="field-grid">
        <NumberField label={tool === 'circle' ? 'Centre X' : tool === 'rect' ? 'Corner X' : 'Start X'} testId="new-x" value={v.x} onCommit={set('x')} />
        <NumberField label={tool === 'circle' ? 'Centre Y' : tool === 'rect' ? 'Corner Y' : 'Start Y'} testId="new-y" value={v.y} onCommit={set('y')} />
        {tool === 'line' && (
          <>
            <NumberField label="Length" testId="new-length" min={0} value={v.length} onCommit={set('length')} />
            <NumberField label="Angle" testId="new-angle" unit="°" value={v.angle} onCommit={set('angle')} title="Degrees counter-clockwise from +X" />
          </>
        )}
        {tool === 'rect' && (
          <>
            <NumberField label="Width" testId="new-width" min={0} value={v.width} onCommit={set('width')} />
            <NumberField label="Height" testId="new-height" min={0} value={v.height} onCommit={set('height')} />
            <NumberField label="Rotation" testId="new-rotation" unit="°" value={v.rotation} onCommit={set('rotation')} />
          </>
        )}
        {tool === 'circle' && (
          <>
            <NumberField label="Radius" testId="new-radius" min={0} value={v.radius} onCommit={set('radius')} />
            <NumberField label="Diameter" testId="new-diameter" min={0} value={v.radius * 2} onCommit={(d) => set('radius')(d / 2)} />
          </>
        )}
      </div>
      <button className="create-btn" data-testid="create-shape" onClick={create} title="Create the object with exactly these values">
        Create
      </button>
    </section>
  );
}
