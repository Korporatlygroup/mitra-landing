import { useTranslations } from 'next-intl';

/** Shown while search results load (search page only; the product page keeps a real 404 status for hidden products). */
export default function Loading() {
  const t = useTranslations('p5buyer');
  return (
    <div role="status" aria-live="polite">
      <h1>{t('title')}</h1>
      <p>{t('loading')}</p>
    </div>
  );
}
