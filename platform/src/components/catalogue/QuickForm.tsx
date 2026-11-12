'use client';

import { useActionState, type ReactNode } from 'react';
import { FormMessage, SubmitButton } from '@/components/ActionForm';
import { idle, type FormState } from '@/lib/form-state';

/**
 * A small one-button form for actions such as "Save product", "Remove" or "Withdraw request". Shows the announced result (an error
 * explains itself in words). Hidden fields carry the ids; nothing else is needed.
 */
export default function QuickForm({
  action,
  fields,
  label,
  srName,
  variant = 'secondary',
  extra,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  label: string;
  /** Product (or request) name added for screen readers only, so repeated buttons are told apart. */
  srName?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  extra?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} className={className ?? 'quick-form'}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {extra}
      <FormMessage state={state} />
      <SubmitButton variant={variant}>
        {label}
        {srName ? <span className="p5b-sr">: {srName}</span> : null}
      </SubmitButton>
    </form>
  );
}
