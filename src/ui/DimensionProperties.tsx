import type { Dispatch } from 'react';
import { describeLinks, measureDimension } from '../model/dimensions';
import { DIMENSION_KIND_LABELS, type ArrowheadStyle, type Dimension, type DimensionStyle, type DrawingDocument } from '../model/types';
import { NumberField } from './NumberField';
import { ARROWHEADS, ARROW_SIZES, TEXT_HEIGHTS } from './Ribbon';
import type { EditorAction } from './state/editorReducer';

/** Style fields shared by one or many selected dimensions. */
export function DimensionStyleFields({ dims, dispatch }: { dims: Dimension[]; dispatch: Dispatch<EditorAction> }) {
  const first = dims[0].style;
  const same = <K extends keyof DimensionStyle>(k: K) => dims.every((d) => d.style[k] === first[k]);
  const set = (patch: Partial<DimensionStyle>) =>
    dispatch({ type: 'updateDimensions', dimensions: dims.map((d) => ({ ...d, style: { ...d.style, ...patch } })), message: 'Dimension style changed' });
  const sel = <K extends keyof DimensionStyle>(label: string, key: K, options: { value: string; label: string }[], parse: (v: string) => DimensionStyle[K], testId: string, title: string) => (
    <label className="field" title={title}>
      <span className="field-label">{label}</span>
      <select data-testid={testId} value={same(key) ? String(first[key]) : ''} onChange={(e) => set({ [key]: parse(e.target.value) } as Partial<DimensionStyle>)}>
        {!same(key) && <option value="">(mixed)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="panel-section">
      <h3>Dimension style</h3>
      {sel('Precision', 'decimals', [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: `${d} decimal${d === 1 ? '' : 's'}` })), Number, 'prop-dim-decimals', 'Decimal places shown')}
      {sel('Text height', 'textHeightMm', TEXT_HEIGHTS.map((h) => ({ value: String(h), label: `${h} mm` })), Number, 'prop-dim-text-height', 'Text height on paper (independent of drawing scale)')}
      {sel('Arrowheads', 'arrowhead', ARROWHEADS.map((a) => ({ value: a.value, label: a.label })), (v) => v as ArrowheadStyle, 'prop-dim-arrowhead', 'Arrowhead style')}
      {sel('Arrow size', 'arrowSizeMm', ARROW_SIZES.map((h) => ({ value: String(h), label: `${h} mm` })), Number, 'prop-dim-arrow-size', 'Arrowhead length on paper')}
      <label className="field" title="Draw extension lines from the measured points to the dimension line">
        <span className="field-label">Ext. lines</span>
        <input type="checkbox" data-testid="prop-dim-ext" checked={dims.every((d) => d.style.showExtensionLines)} onChange={(e) => set({ showExtensionLines: e.target.checked })} />
      </label>
    </section>
  );
}

export function DimensionProperties({ dim, doc, dispatch }: { dim: Dimension; doc: DrawingDocument; dispatch: Dispatch<EditorAction> }) {
  const value = measureDimension(doc, dim);
  const u = (next: Dimension, what: string) => dispatch({ type: 'updateDimensions', dimensions: [next], message: `Dimension: ${what}` });
  const unit = dim.kind === 'angular' ? '°' : 'mm';
  return (
    <>
      <section className="panel-section" data-testid={`props-dim-${dim.kind}`}>
        <h3>{DIMENSION_KIND_LABELS[dim.kind]}</h3>
        <div className="driven-badge" data-testid="dim-mode" title="A driven dimension MEASURES the geometry it is linked to and updates automatically. Its value cannot be typed: change the geometry instead. (User-entered constraints that drive geometry would be a separate, clearly marked type.)">
          Driven · measured from geometry
        </div>
        <NumberField label="Value" testId="dim-value" unit={unit} value={value ?? NaN} readOnly title="Measured value (read-only)" />
        <dl className="info">
          <dt>Links</dt>
          <dd data-testid="dim-links">{describeLinks(doc, dim)}</dd>
        </dl>
        {(dim.kind === 'aligned' || dim.kind === 'horizontal' || dim.kind === 'vertical') && (
          <NumberField label="Offset" testId="dim-offset" value={dim.offset} onCommit={(v) => u({ ...dim, offset: v }, 'offset')} title="Distance of the dimension line from the first point (drawing mm)" />
        )}
        {(dim.kind === 'radius' || dim.kind === 'diameter') && (
          <NumberField label="Leader angle" testId="dim-angle" unit="°" value={dim.angleDeg} onCommit={(v) => u({ ...dim, angleDeg: v }, 'leader angle')} title="Direction of the dimension line from the centre" />
        )}
        {dim.kind === 'angular' && (
          <NumberField label="Arc radius" testId="dim-arc-radius" min={0.000001} value={dim.radius} onCommit={(v) => u({ ...dim, radius: v }, 'arc radius')} title="Distance of the arc from the vertex (drawing mm)" />
        )}
        <NumberField label="Text shift" testId="dim-text-shift" value={dim.textShift} onCommit={(v) => u({ ...dim, textShift: v }, 'text position')} title="Move the text along the dimension line (drawing mm)" />
        <p className="hint">Drag the dimension or its grips to reposition it. Its value follows the geometry.</p>
      </section>
      <DimensionStyleFields dims={[dim]} dispatch={dispatch} />
    </>
  );
}
