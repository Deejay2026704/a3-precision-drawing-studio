import { useState, type Dispatch } from 'react';
import { vec } from '../geometry/vec';
import { createArc, createCircle, createLine, createPolygon, createRect } from '../model/shapes';
import { polarPoint } from '../geometry/angles';
import type { Shape, ShapeId, ShapeStyle } from '../model/types';
import { describeCreated } from './DrawingCanvas';
import { NumberField } from './NumberField';
import type { EditorAction } from './state/editorReducer';

/**
 * Exact numeric creation for the active draw tool: type the values, press Create.
 * Line: start, length, angle. Rectangle: corner, width, height, rotation. Circle: centre, radius/diameter.
 */
export function CreateByNumbers({ tool, style, dispatch, newId, polygonSides = 6 }: { tool: 'line' | 'rect' | 'circle' | 'arc' | 'polygon'; style: ShapeStyle; dispatch: Dispatch<EditorAction>; newId: () => ShapeId; polygonSides?: number }) {
  const [v, setV] = useState({ x: 0, y: 0, length: 100, angle: 0, width: 100, height: 50, rotation: tool === 'polygon' ? 90 : 0, radius: 25, start: 0, sweep: 90 });
  const set = (k: keyof typeof v) => (n: number) => setV((o) => ({ ...o, [k]: n }));

  const create = () => {
    let shape: Shape;
    if (tool === 'line') {
      if (!(v.length > 0)) return dispatch({ type: 'setMessage', message: '⚠ Length must be greater than zero' });
      shape = createLine(newId(), vec(v.x, v.y), polarPoint(vec(v.x, v.y), v.length, v.angle), style);
    } else if (tool === 'rect') {
      if (!(v.width > 0 && v.height > 0)) return dispatch({ type: 'setMessage', message: '⚠ Width and height must be greater than zero' });
      shape = createRect(newId(), vec(v.x, v.y), v.width, v.height, v.rotation, style);
    } else if (tool === 'polygon') {
      if (!(v.radius > 0)) return dispatch({ type: 'setMessage', message: '⚠ Radius must be greater than zero' });
      shape = createPolygon(newId(), vec(v.x, v.y), v.radius, polygonSides, v.rotation, style);
    } else if (tool === 'arc') {
      if (!(v.radius > 0)) return dispatch({ type: 'setMessage', message: '⚠ Radius must be greater than zero' });
      if (!(v.sweep > 0 && v.sweep < 360)) return dispatch({ type: 'setMessage', message: '⚠ Sweep must be between 0° and 360°' });
      shape = createArc(newId(), vec(v.x, v.y), v.radius, v.start, v.sweep, style);
    } else {
      if (!(v.radius > 0)) return dispatch({ type: 'setMessage', message: '⚠ Radius must be greater than zero' });
      shape = createCircle(newId(), vec(v.x, v.y), v.radius, style);
    }
    dispatch({ type: 'addShapes', shapes: [shape], message: describeCreated(shape) });
  };

  const title = tool === 'line' ? 'New line' : tool === 'rect' ? 'New rectangle' : tool === 'arc' ? 'New arc' : tool === 'polygon' ? 'New polygon' : 'New circle';
  const centred = tool === 'circle' || tool === 'arc' || tool === 'polygon';
  return (
    <section className="panel-section create-section" data-testid={`create-${tool}`}>
      <h3>{title} by numbers</h3>
      <div className="field-grid">
        <NumberField label={centred ? 'Centre X' : tool === 'rect' ? 'Corner X' : 'Start X'} testId="new-x" value={v.x} onCommit={set('x')} />
        <NumberField label={centred ? 'Centre Y' : tool === 'rect' ? 'Corner Y' : 'Start Y'} testId="new-y" value={v.y} onCommit={set('y')} />
        {tool === 'polygon' && (
          <>
            <NumberField label="Sides" unit="" testId="new-sides" min={3} value={polygonSides} onCommit={(n) => (Number.isInteger(n) && n >= 3 && n <= 64 ? dispatch({ type: 'setPolygonSides', sides: n }) : dispatch({ type: 'setMessage', message: '⚠ Sides must be a whole number from 3 to 64' }))} title="Number of sides (also used when clicking a polygon)" />
            <NumberField label="Radius" testId="new-radius" min={0} value={v.radius} onCommit={set('radius')} title="Centre to corner" />
            <NumberField label="Across flats" testId="new-flats" min={0} value={2 * v.radius * Math.cos(Math.PI / polygonSides)} onCommit={(f) => set('radius')(f / (2 * Math.cos(Math.PI / polygonSides)))} title="Distance between opposite sides (even number of sides) – sets the radius" />
            <NumberField label="First corner" testId="new-rotation" unit="°" value={v.rotation} onCommit={set('rotation')} title="Angle of the first corner, counter-clockwise from +X" />
          </>
        )}
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
        {tool === 'arc' && (
          <>
            <NumberField label="Radius" testId="new-radius" min={0} value={v.radius} onCommit={set('radius')} />
            <NumberField label="Start angle" testId="new-start" unit="°" value={v.start} onCommit={set('start')} title="Degrees counter-clockwise from +X" />
            <NumberField label="Sweep" testId="new-sweep" unit="°" value={v.sweep} onCommit={set('sweep')} title="Counter-clockwise, between 0° and 360°" />
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
