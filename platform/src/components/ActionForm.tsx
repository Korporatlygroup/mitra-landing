'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { idle, type FormState } from '@/lib/form-state';

export function SubmitButton({
  children,
  variant = 'primary',
  name,
  value,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={`btn btn-${variant}`} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}

/** Announces the result of an action. Errors start with a word ("Error"), so meaning never depends on colour. */
export function FormMessage({ state }: { state: FormState }) {
  const t = useTranslations();
  const text = state.messageKey ? t(state.messageKey, state.data ?? {}) : '';
  return (
    <div role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite" className="form-message-slot">
      {text ? (
        <p className={state.status === 'error' ? 'message message-error' : 'message message-ok'}>
          <strong>{state.status === 'error' ? t('common.error') : t('common.done')}: </strong>
          {text}
        </p>
      ) : null}
    </div>
  );
}

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  /** Optional second submit button (e.g. "Save and finish later"), sent as intent=<value>. */
  secondary?: { label: string; value: string };
}

/** Generic form wrapper: pending state, announced result, and restoring non-secret values React resets after an action. */
export default function ActionForm({ action, submitLabel, children, variant = 'primary', className, secondary }: Props) {
  const [state, formAction] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form || state.status !== 'error' || !state.values) return;
    for (const [name, value] of Object.entries(state.values)) {
      const el = form.elements.namedItem(name);
      if (!el) continue;
      if (el instanceof RadioNodeList) {
        for (const node of Array.from(el)) {
          if (node instanceof HTMLInputElement && node.type === 'radio') node.checked = node.value === value;
        }
      } else if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox') el.checked = true;
        else if (el.type === 'radio') el.checked = el.value === value;
        else if (el.type !== 'hidden') el.value = value;
      } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        el.value = value;
      }
    }
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className ?? 'form'}>
      {children}
      <FormMessage state={state} />
      <SubmitButton variant={variant} name={secondary ? 'intent' : undefined} value={secondary ? 'next' : undefined}>
        {submitLabel}
      </SubmitButton>
      {secondary ? (
        <SubmitButton variant="secondary" name="intent" value={secondary.value}>
          {secondary.label}
        </SubmitButton>
      ) : null}
    </form>
  );
}
