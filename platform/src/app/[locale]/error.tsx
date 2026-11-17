'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Last-resort state for any page that fails while rendering: plain words and two ways out, never an unexplained blank screen. */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <section role="alert" aria-labelledby="page-err-h" style={{ maxWidth: '40rem', margin: '48px auto', padding: '0 16px' }}>
      <h1 id="page-err-h">{t('errorTitle')}</h1>
      <p>{t('errorBody')}</p>
      <p className="link-row">
        <button type="button" className="btn btn-primary" onClick={reset}>
          {t('errorRetry')}
        </button>
        <Link href="/" className="btn btn-secondary">
          {t('errorHome')}
        </Link>
      </p>
    </section>
  );
}
