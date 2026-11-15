'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { decideAction } from '@/app/[locale]/admin/verification/actions';
import { FormMessage } from '@/components/ActionForm';
import Icon from '@/components/ui/Icon';
import { idle } from '@/lib/form-state';

const CHECKS = ['checkName', 'checkSsm', 'checkValid'] as const;

function Save({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={disabled || pending} aria-busy={pending}>
      {label}
    </button>
  );
}

/** Decision area of a claim review: checklist, Approve / Ask for more info / Don't accept, a required reason, Save (off until a decision is chosen). */
export default function DecisionForm({ claimId, version }: { claimId: string; version: number }) {
  const t = useTranslations('adminVer');
  const a = useTranslations('adm2');
  const locale = useLocale();
  const [state, action] = useActionState(decideAction, idle);
  const [decision, setDecision] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  // React clears uncontrolled fields after every action submission, success or failure.
  // The reason (and decision/checklist, kept here as React state already) must survive a failed save.
  useEffect(() => {
    const reason = state.values?.reason;
    if (state.status === 'error' && reason) {
      const el = formRef.current?.elements.namedItem('reason');
      if (el instanceof HTMLTextAreaElement) el.value = reason;
    }
  }, [state]);
  const options = [
    ['approve', t('approve')],
    ['request_info', t('requestInfo')],
    ['reject', t('reject')],
  ] as const;
  return (
    <form ref={formRef} action={action} className="form" style={{ maxWidth: 'none' }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <fieldset>
        <legend>{a('checklistTitle')}</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHECKS.map((k) => {
            const on = checked.includes(k);
            return (
              <label key={k} className={`ck${on ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  name="checks"
                  value={a(k)}
                  checked={on}
                  onChange={() => setChecked((c) => (on ? c.filter((x) => x !== k) : [...c, k]))}
                />
                <span className="box" aria-hidden="true">
                  {on ? <Icon name="check" size={14} stroke={3} /> : null}
                </span>
                {a(k)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t('decisionTitle')}</legend>
        <div className="decisions">
          {options.map(([value, label]) => (
            <label key={value} className={`dec${decision === value ? ' on' : ''}`}>
              <input type="radio" id={`d-${value === 'request_info' ? 'info' : value}`} name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} required />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="reason">{t('reason')}</label>
        <p className="hint">{t('reasonHint')}</p>
        <textarea id="reason" name="reason" rows={4} required maxLength={900} />
      </div>
      <FormMessage state={state} />
      {!decision ? <p className="mut" style={{ margin: 0, fontSize: '0.875rem' }}>{a('pickDecision')}</p> : null}
      <Save disabled={!decision} label={t('saveDecision')} />
    </form>
  );
}
