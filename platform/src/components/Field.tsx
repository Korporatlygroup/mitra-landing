import type { ReactNode } from 'react';

interface FieldProps {
  id: string;
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  hint?: string;
  required?: boolean;
  requiredLabel?: string;
  autoComplete?: string;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
  inputMode?: 'numeric' | 'text' | 'email';
  pattern?: string;
}

/** Labelled text input with an optional hint tied in via aria-describedby. */
export function Field({ id, name, label, type = 'text', hint, required, requiredLabel, ...rest }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && requiredLabel ? <span className="req"> ({requiredLabel})</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <input id={id} name={name} type={type} required={required} aria-describedby={hintId} {...rest} />
    </div>
  );
}

export function SelectField({
  id,
  name,
  label,
  children,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  children: ReactNode;
  defaultValue?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={defaultValue}>
        {children}
      </select>
    </div>
  );
}

export function CheckField({ id, name, label, required = true, defaultChecked }: { id: string; name: string; label: string; required?: boolean; defaultChecked?: boolean }) {
  return (
    <div className="field check">
      <input id={id} name={name} type="checkbox" required={required} defaultChecked={defaultChecked} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function FileField({ id, name, label, hint, accept }: { id: string; name: string; label: string; hint?: string; accept?: string }) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <input id={id} name={name} type="file" required accept={accept} aria-describedby={hintId} />
    </div>
  );
}

export function TextArea({
  id,
  name,
  label,
  hint,
  required,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <textarea id={id} name={name} rows={4} required={required} maxLength={maxLength} aria-describedby={hintId} />
    </div>
  );
}
