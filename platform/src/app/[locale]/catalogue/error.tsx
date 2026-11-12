'use client';

import { useTranslations } from 'next-intl';

/** Last-resort error state for the catalogue pages: plain words and a way to try again (no technical detail is shown). */
export default function CatalogueError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('p5buyer.errorPage');
  return (
    <section role="alert" aria-labelledby="cat-err-h">
      <h1 id="cat-err-h">{t('title')}</h1>
      <p>{t('body')}</p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        {t('retry')}
      </button>
    </section>
  );
}
