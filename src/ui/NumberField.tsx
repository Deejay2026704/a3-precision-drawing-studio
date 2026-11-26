import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatNumber, parseNumberInput, roundTo } from '../geometry/units';

interface Props {
  label: string;
  value: number;
  onCommit?: (value: number) => void;
  unit?: string;
  min?: number;
  readOnly?: boolean;
  testId?: string;
  title?: string;
  /** For action fields (e.g. "Rotate by"): show `value` again after each commit. */
  resetAfterCommit?: boolean;
}

/**
 * Numeric entry for exact values. Commits on Enter or when focus leaves;
 * Escape reverts. Invalid input is rejected and the previous value restored.
 */
export function NumberField({ label, value, onCommit, unit = 'mm', min, readOnly, testId, title, resetAfterCommit }: Props) {
  const [text, setTextState] = useState(formatNumber(value));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  // Refs hold the latest values so that handlers firing back-to-back (Enter then blur,
  // Escape then blur) never act on a stale render.
  const textRef = useRef(text);
  const valueRef = useRef(value);
  valueRef.current = value;
  /** Value sent with onCommit that the parent has not yet re-rendered with. */
  const pendingRef = useRef<number | null>(null);
  const skipBlurCommit = useRef(false);

  const setText = (t: string) => {
    textRef.current = t;
    setTextState(t);
  };

  useEffect(() => {
    pendingRef.current = null;
  }, [value]);

  const same = (a: number, b: number) => roundTo(a, 9) === roundTo(b, 9);

  const commit = () => {
    const n = parseNumberInput(textRef.current);
    if (n === null || (min !== undefined && n < min)) {
      setError(true);
      setText(formatNumber(valueRef.current));
      return;
    }
    setError(false);
    setText(formatNumber(resetAfterCommit ? valueRef.current : n));
    if (pendingRef.current !== null && same(n, pendingRef.current)) return; // already committed
    if (same(n, valueRef.current)) return; // unchanged
    pendingRef.current = resetAfterCommit ? null : n;
    onCommit?.(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.select();
    } else if (e.key === 'Escape') {
      // Revert: discard the typed text and leave the field WITHOUT committing.
      setText(formatNumber(valueRef.current));
      setError(false);
      skipBlurCommit.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <label className={`field${error ? ' field-error' : ''}`} title={title}>
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        data-testid={testId}
        // While not being edited, always show the model value directly (never a stale copy).
        value={focused ? text : formatNumber(value)}
        readOnly={readOnly || !onCommit}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onFocus={(e) => {
          setText(formatNumber(valueRef.current));
          setFocused(true);
          pendingRef.current = null;
          e.currentTarget.select();
        }}
        onBlur={() => {
          if (skipBlurCommit.current) skipBlurCommit.current = false;
          else if (!readOnly && onCommit) commit();
          setFocused(false);
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      <span className="field-unit">{unit}</span>
    </label>
  );
}
