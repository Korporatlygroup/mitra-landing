import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Friendly 404 for a product that is not shown (never published, withdrawn, paused, or a wrong link). It says nothing about which. */
export default function ProductNotFound() {
  const t = useTranslations('p5buyer.notFound');
  return (
    <section aria-labelledby="nf-h">
      <title>{t('title')}</title>
      <h1 id="nf-h">{t('title')}</h1>
      <p>{t('body')}</p>
      <p className="link-row">
        <Link href="/catalogue" className="btn btn-primary">
          {t('browse')}
        </Link>
        <Link href="/catalogue/saved" className="btn btn-secondary">
          {t('saved')}
        </Link>
      </p>
    </section>
  );
}
