import { useRef, useState, type KeyboardEvent } from 'react';

/** Text entry that commits on Enter / leaving the field; Escape reverts. */
export function TextField({ label, value, maxLength, onCommit, testId, title }: { label: string; value: string; maxLength: number; onCommit: (v: string) => void; testId?: string; title?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const skipBlur = useRef(false);
  const commit = (v: string) => {
    const t = v.slice(0, maxLength);
    if (t !== value) onCommit(t);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit(text);
    if (e.key === 'Escape') {
      setText(value);
      skipBlur.current = true;
      e.currentTarget.blur();
    }
  };
  return (
    <label className="field text-field" title={title}>
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        data-testid={testId}
        value={focused ? text : value}
        maxLength={maxLength}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          setText(value);
          setFocused(true);
        }}
        onBlur={() => {
          if (skipBlur.current) skipBlur.current = false;
          else commit(text);
          setFocused(false);
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </label>
  );
}
