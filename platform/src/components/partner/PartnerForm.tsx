'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { SubmitButton, FormMessage } from '@/components/ActionForm';
import { idle, type FormState } from '@/lib/form-state';
import { Link } from '@/i18n/navigation';

export interface ExtraButton {
  label: string;
  value: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  /** Extra submit buttons sent as intent=<value> (the main button sends intent=primary). */
  extra?: ExtraButton[];
  /** Hide the main submit button (only the extra buttons are shown). */
  noMain?: boolean;
  /** When set and the action fails with `stale_version`, a "reload" panel is shown (the typed input stays in the form). */
  reloadHref?: string;
  /** Move keyboard focus to the result message when an error comes back. */
  focusOnError?: boolean;
}

/**
 * Like ActionForm (pending state, announced result, restores values React resets after an action), plus extra named submit buttons and the
 * "someone changed this" panel for optimistic-lock conflicts. Controlled fields keep their value; plain fields are restored from `state.values`.
 */
export default function PartnerForm({ action, submitLabel, children, variant = 'primary', className, extra, noMain, reloadHref, focusOnError = true }: Props) {
  const t = useTranslations('p5partner.common');
  const [state, formAction] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form || state.status !== 'error') return;
    if (state.values) {
      for (const [name, value] of Object.entries(state.values)) {
        const el = form.elements.namedItem(name);
        if (!el) continue;
        if (el instanceof RadioNodeList) {
          for (const node of Array.from(el)) if (node instanceof HTMLInputElement && node.type === 'radio') node.checked = node.value === value;
        } else if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox') el.checked = true;
          else if (el.type !== 'hidden' && el.type !== 'file' && el.type !== 'radio') el.value = value;
        } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          el.value = value;
        }
      }
    }
    if (focusOnError) form.querySelector<HTMLElement>('.form-message-slot')?.scrollIntoView?.({ block: 'nearest' });
  }, [state, focusOnError]);

  const conflict = state.status === 'error' && state.messageKey === 'errors.stale_version';

  return (
    <form ref={ref} action={formAction} className={className ?? 'form form-wide'} noValidate={false}>
      {children}
      <FormMessage state={state} />
      {conflict && reloadHref ? (
        <div className="message message-error" role="alert">
          <p style={{ margin: '0 0 8px' }}>{t('conflictBody')}</p>
          <a className="btn btn-secondary" href={reloadHref}>
            {t('conflictReload')}
          </a>
        </div>
      ) : null}
      <div className="btn-row">
        {noMain ? null : (
          <SubmitButton variant={variant} name="intent" value="primary">
            {submitLabel}
          </SubmitButton>
        )}
        {(extra ?? []).map((b) => (
          <SubmitButton key={b.value} variant={b.variant ?? 'secondary'} name="intent" value={b.value}>
            {b.label}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}

/** A server-rendered link styled as a button. */
export function ButtonLink({ href, children, variant = 'secondary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={href} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}
