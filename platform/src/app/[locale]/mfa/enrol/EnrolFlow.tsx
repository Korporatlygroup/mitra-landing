'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ActionForm';
import { idle } from '@/lib/form-state';
import { confirmEnrolAction, startEnrolAction } from './actions';

export default function EnrolFlow({ locale, next }: { locale: string; next: string }) {
  const t = useTranslations('mfa');
  const [start, startAction] = useActionState(startEnrolAction, idle);
  const [confirm, confirmAction] = useActionState(confirmEnrolAction, idle);
  const enrol = start.data;

  if (!enrol) {
    return (
      <form action={startAction} className="form">
        <FormMessage state={start} />
        <SubmitButton>{t('start')}</SubmitButton>
      </form>
    );
  }

  return (
    <div className="form">
      <p>{t('scan')}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qr" src={enrol.qrCode} alt={t('qrAlt')} width={220} height={220} />
      <p>
        {t('secretLabel')} <code>{enrol.secret}</code>
      </p>
      <form action={confirmAction} className="form">
        <input type="hidden" name="factorId" value={enrol.factorId} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="code">{t('enterCode')}</label>
          <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        </div>
        <FormMessage state={confirm} />
        <SubmitButton>{t('confirm')}</SubmitButton>
      </form>
    </div>
  );
}
