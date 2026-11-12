import type { ReactNode } from 'react';

/** Labelled inputs for the partner forms (server and client safe). Every control has a visible label; hints are tied in with aria-describedby. */
interface Base {
  id: string;
  name: string;
  label: string;
  hint?: string;
  optionalLabel?: string;
}

const Wrap = ({ id, label, hint, optionalLabel, children }: Base & { children: ReactNode }) => (
  <div className="field">
    <label htmlFor={id}>
      {label}
      {optionalLabel ? <span className="req"> ({optionalLabel})</span> : null}
    </label>
    {hint ? (
      <p id={`${id}-hint`} className="hint">
        {hint}
      </p>
    ) : null}
    {children}
  </div>
);

export function TextInput(
  p: Base & { type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'url'; defaultValue?: string; required?: boolean; maxLength?: number; inputMode?: 'numeric' | 'decimal' | 'text'; autoComplete?: string; min?: number; max?: number; lang?: string },
) {
  const { id, name, type = 'text', defaultValue, required, maxLength, inputMode, autoComplete, min, max } = p;
  return (
    <Wrap {...p}>
      <input id={id} name={name} type={type} defaultValue={defaultValue} required={required} maxLength={maxLength} inputMode={inputMode} autoComplete={autoComplete} min={min} max={max} aria-describedby={p.hint ? `${id}-hint` : undefined} />
    </Wrap>
  );
}

export function TextAreaInput(p: Base & { defaultValue?: string; required?: boolean; maxLength?: number; rows?: number }) {
  const { id, name, defaultValue, required, maxLength, rows = 4 } = p;
  return (
    <Wrap {...p}>
      <textarea id={id} name={name} defaultValue={defaultValue} required={required} maxLength={maxLength} rows={rows} aria-describedby={p.hint ? `${id}-hint` : undefined} />
    </Wrap>
  );
}

export function SelectInput(p: Base & { defaultValue?: string; required?: boolean; children: ReactNode }) {
  const { id, name, defaultValue, required, children } = p;
  return (
    <Wrap {...p}>
      <select id={id} name={name} defaultValue={defaultValue} required={required} aria-describedby={p.hint ? `${id}-hint` : undefined}>
        {children}
      </select>
    </Wrap>
  );
}

export function CheckInput({ id, name, label, defaultChecked, value = 'on', hint }: { id: string; name: string; label: string; defaultChecked?: boolean; value?: string; hint?: string }) {
  return (
    <div className="field check">
      <input id={id} name={name} type="checkbox" value={value} defaultChecked={defaultChecked} aria-describedby={hint ? `${id}-hint` : undefined} />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint ? (
          <p id={`${id}-hint`} className="hint" style={{ margin: 0 }}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
