import { useState } from 'react';
import { STANDARD_SCALES, formatScale, parseScale, scalesEqual, type DrawingScale } from '../geometry/scale';

/** Drawing scale chooser: standard scales 1:1 … 1:100 plus custom entry (e.g. 1:25, 2:1). */
export function ScaleSelector({ scale, onChange }: { scale: DrawingScale; onChange: (s: DrawingScale) => void }) {
  const isStandard = STANDARD_SCALES.some((s) => scalesEqual(s, scale));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(formatScale(scale));
  const [error, setError] = useState(false);

  const apply = () => {
    const s = parseScale(text);
    if (!s) {
      setError(true);
      return;
    }
    setError(false);
    setEditing(false);
    onChange(s);
  };

  return (
    <div className="scale-selector">
      <select
        data-testid="scale-select"
        value={editing ? 'custom' : isStandard ? formatScale(scale) : 'custom'}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setText(formatScale(scale));
            setEditing(true);
          } else {
            setEditing(false);
            const s = parseScale(e.target.value);
            if (s) onChange(s);
          }
        }}
      >
        {STANDARD_SCALES.map((s) => (
          <option key={formatScale(s)} value={formatScale(s)}>
            {formatScale(s)}
          </option>
        ))}
        <option value="custom">{isStandard ? 'Custom…' : `Custom (${formatScale(scale)})`}</option>
      </select>
      {editing && (
        <span className="scale-custom">
          <input
            data-testid="scale-custom-input"
            className={error ? 'field-error' : ''}
            value={text}
            size={7}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
              if (e.key === 'Escape') setEditing(false);
            }}
            title="Enter paper:real, e.g. 1:25 or 2:1"
          />
          <button data-testid="scale-custom-apply" onClick={apply}>
            Apply
          </button>
        </span>
      )}
    </div>
  );
}
