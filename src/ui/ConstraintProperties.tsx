import type { Dispatch } from 'react';
import { constraintShapeIds, constraintStatus, describeConstraint, updateConstraint, type ConstraintStatus } from '../model/constraints';
import { assignToLayer, layerOf } from '../model/layers';
import { CONSTRAINT_LABELS, SHAPE_KIND_LABELS, type Constraint, type Dimension, type DrawingDocument, type Shape } from '../model/types';
import { NumberField } from './NumberField';
import type { EditorAction } from './state/editorReducer';

const STATUS: Record<ConstraintStatus, { text: string; cls: string }> = {
  satisfied: { text: 'Satisfied', cls: 'ok' },
  unsatisfied: { text: 'NOT satisfied – conflicts with other constraints or with locked geometry', cls: 'bad' },
  suppressed: { text: 'Suppressed – ignored by the solver', cls: 'off' },
  broken: { text: 'Broken – refers to missing, zero-size or unsupported geometry', cls: 'bad' },
};

/** Properties of one selected DRIVING constraint: status, value, suppress, delete. */
export function ConstraintProperties({ c, doc, dispatch }: { c: Constraint; doc: DrawingDocument; dispatch: Dispatch<EditorAction> }) {
  const status = constraintStatus(doc, c);
  const apply = (next: Constraint) => {
    const r = updateConstraint(doc, next);
    dispatch(r.ok ? { type: 'commitDocument', doc: r.doc, message: r.message } : { type: 'setMessage', message: `⚠ ${r.message}` });
  };
  const refs = constraintShapeIds(c).map((id) => {
    const s = doc.shapes.find((x) => x.id === id);
    return s ? SHAPE_KIND_LABELS[s.kind] : 'missing object';
  });
  return (
    <section className="panel-section" data-testid={`props-constraint-${c.kind}`}>
      <h3>{CONSTRAINT_LABELS[c.kind]} constraint</h3>
      <div className="driving-badge" data-testid="constraint-mode" title="A driving constraint CONTROLS geometry: the solver moves objects to satisfy it. (Dimensions are reference dimensions: they only report measurements.)">
        Driving · controls geometry
      </div>
      <div className={`constraint-status ${STATUS[status].cls}`} data-testid="constraint-status" data-status={status}>
        {STATUS[status].text}
      </div>
      <dl className="info">
        <dt>Applies to</dt>
        <dd>{refs.join(' + ')}</dd>
      </dl>
      {c.kind === 'fixed-length' && (
        <NumberField label="Length" testId="constraint-value" min={0.000001} value={c.value} onCommit={(v) => apply({ ...c, value: v })} title="Driving value – the line is changed to this length" />
      )}
      {c.kind === 'fixed-angle' && (
        <NumberField label="Angle" unit="°" testId="constraint-value" value={c.value} onCommit={(v) => apply({ ...c, value: v })} title="Driving value – degrees counter-clockwise from +X" />
      )}
      {c.kind === 'fixed-radius' && (
        <NumberField label="Radius" testId="constraint-value" min={0.000001} value={c.value} onCommit={(v) => apply({ ...c, value: v })} title="Driving value – the circle/arc is changed to this radius" />
      )}
      {c.kind === 'angle' && (
        <NumberField label="Angle" unit="°" testId="constraint-value" min={0} value={c.value} onCommit={(v) => (v <= 180 ? apply({ ...c, value: v }) : dispatch({ type: 'setMessage', message: '⚠ Angle must be between 0° and 180°' }))} title="Driving value – angle between the two lines' directions, 0–180°" />
      )}
      {c.kind === 'fixed-position' && (
        <div className="field-grid">
          <NumberField label="X" testId="constraint-x" value={c.x} onCommit={(v) => apply({ ...c, x: v })} />
          <NumberField label="Y" testId="constraint-y" value={c.y} onCommit={(v) => apply({ ...c, y: v })} />
        </div>
      )}
      <label className="field" title="A suppressed constraint is kept but ignored">
        <span className="field-label">Suppressed</span>
        <input type="checkbox" data-testid="constraint-suppress" checked={c.suppressed} onChange={(e) => apply({ ...c, suppressed: e.target.checked })} />
      </label>
      <button className="danger-btn" data-testid="constraint-delete" onClick={() => dispatch({ type: 'deleteSelection' })} title="Delete this constraint (the geometry stays where it is)">
        Delete constraint
      </button>
      <p className="hint">{describeConstraint(doc, c)}. Values are applied only if all constraints can still be satisfied.</p>
    </section>
  );
}

/** Layer assignment for the selected shapes/dimensions. */
export function LayerAssign({ items, doc, dispatch }: { items: (Shape | Dimension)[]; doc: DrawingDocument; dispatch: Dispatch<EditorAction> }) {
  const ids = new Set(items.map((x) => layerOf(doc, x).id));
  const current = ids.size === 1 ? [...ids][0] : '';
  return (
    <section className="panel-section">
      <label className="field" title="Move the selected objects to another layer">
        <span className="field-label">Layer</span>
        <select
          data-testid="prop-layer"
          value={current}
          onChange={(e) => {
            const r = assignToLayer(doc, items.map((x) => x.id), e.target.value);
            dispatch(r.ok ? { type: 'commitDocument', doc: r.doc, message: r.message } : { type: 'setMessage', message: `⚠ ${r.message}` });
          }}
        >
          {current === '' && <option value="">(mixed)</option>}
          {doc.layers.map((l) => (
            <option key={l.id} value={l.id} disabled={l.locked}>
              {l.name}
              {l.locked ? ' (locked)' : ''}
              {!l.visible ? ' (hidden)' : ''}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
