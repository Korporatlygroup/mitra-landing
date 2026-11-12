import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageLinks } from './helpers';

/** "Showing 1 to 25 of 60" with Previous / Next links (query string `offset`, plus any other fixed parameters). */
export default async function Pager({
  locale,
  base,
  offset,
  total,
  params = {},
}: {
  locale: string;
  base: string;
  offset: number;
  total: number;
  params?: Record<string, string>;
}) {
  const t = await getTranslations({ locale, namespace: 'p5admin.pager' });
  const { prev, next, from, to } = pageLinks(offset, total);
  const href = (o: number) => {
    const q = new URLSearchParams({ ...params, ...(o > 0 ? { offset: String(o) } : {}) }).toString();
    return q ? `${base}?${q}` : base;
  };
  return (
    <nav aria-label={t('label')} className="adm-pager">
      <p className="muted" style={{ margin: 0 }}>
        {t('range', { from, to, total })}
      </p>
      {prev !== null ? (
        <Link href={href(prev)} locale={locale} className="btn btn-secondary" rel="prev">
          {t('prev')}
        </Link>
      ) : null}
      {next !== null ? (
        <Link href={href(next)} locale={locale} className="btn btn-secondary" rel="next">
          {t('next')}
        </Link>
      ) : null}
    </nav>
  );
}
