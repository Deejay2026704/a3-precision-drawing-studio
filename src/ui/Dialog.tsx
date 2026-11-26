import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface DialogButton {
  readonly id: string;
  readonly label: string;
  readonly kind?: 'primary' | 'danger' | 'normal';
}

export interface DialogSpec {
  readonly title: string;
  readonly message: ReactNode;
  readonly detail?: readonly string[];
  readonly buttons: readonly DialogButton[];
  /** Button returned when the dialog is dismissed with Esc. */
  readonly cancelId: string;
  /** Optional single choice (e.g. target layer), returned with the button. */
  readonly choice?: { readonly label: string; readonly options: readonly { value: string; label: string }[]; readonly initial?: string };
  readonly testId?: string;
}

export interface DialogAnswer {
  readonly button: string;
  readonly choice?: string;
}

/** Modal dialog driven by `ask(spec)`, which resolves with the button the user chose. */
export function useDialog(): [ReactNode, (spec: DialogSpec) => Promise<DialogAnswer>] {
  const [open, setOpen] = useState<{ spec: DialogSpec; resolve: (a: DialogAnswer) => void } | null>(null);
  const ask = useCallback((spec: DialogSpec) => new Promise<DialogAnswer>((resolve) => setOpen({ spec, resolve })), []);
  const element = open ? (
    <DialogView
      spec={open.spec}
      onClose={(a) => {
        setOpen(null);
        open.resolve(a);
      }}
    />
  ) : null;
  return [element, ask];
}

function DialogView({ spec, onClose }: { spec: DialogSpec; onClose: (a: DialogAnswer) => void }) {
  const [choice, setChoice] = useState(spec.choice?.initial ?? spec.choice?.options[0]?.value);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose({ button: spec.cancelId });
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [spec, onClose]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" data-testid={spec.testId ?? 'dialog'}>
        <h2 id="dialog-title">{spec.title}</h2>
        <div className="dialog-message" data-testid="dialog-message">
          {spec.message}
        </div>
        {spec.detail && spec.detail.length > 0 && (
          <ul className="dialog-detail" data-testid="dialog-detail">
            {spec.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
        {spec.choice && (
          <label className="dialog-choice">
            {spec.choice.label}
            <select data-testid="dialog-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {spec.choice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="dialog-buttons">
          {spec.buttons.map((b, i) => (
            <button
              key={b.id}
              ref={i === 0 ? first : undefined}
              className={`dialog-btn ${b.kind ?? 'normal'}`}
              data-testid={`dialog-${b.id}`}
              onClick={() => onClose({ button: b.id, choice })}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
