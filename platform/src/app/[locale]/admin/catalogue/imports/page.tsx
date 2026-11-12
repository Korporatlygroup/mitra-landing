import { getFormatter, getTranslations } from 'next-intl/server';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { catalogueStats } from '@/server/services/p5-admin';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.imports.title');
}

/**
 * Read-only view of catalogue import activity. The database offers administrators the totals only (catalogue_stats): there is no
 * function that lists import jobs across partners, and this page deliberately does not read the tables around the access rules.
 */
export default async function AdminImportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue/imports');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const fmt = await getFormatter({ locale });
  if (!ctx.canStats) return <NoAccess locale={locale} title={t('imports.title')} />;

  const res = await catalogueStats(ctx.session.supabase);
  const s = res.ok ? res.data : null;
  return (
    <>
      <h1>{t('imports.title')}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="imports" />
      <p>{t('imports.intro')}</p>
      {!s ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {t('home.statsFailed')}
        </p>
      ) : (
        <>
          <ul className="adm-stats">
            <li className="card" data-testid="stat-import-failed">
              <p className="muted" style={{ margin: 0 }}>
                {t('home.stats.importJobsFailed')}
              </p>
              <p className="p5-stat" style={{ margin: '4px 0' }} data-testid="stat-import-failed-value">
                {fmt.number(s.imports.jobs_failed)}
              </p>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {t('imports.failedNote')}
              </p>
            </li>
            <li className="card" data-testid="stat-import-rows">
              <p className="muted" style={{ margin: 0 }}>
                {t('home.stats.importRowsInvalid')}
              </p>
              <p className="p5-stat" style={{ margin: '4px 0' }} data-testid="stat-import-rows-value">
                {fmt.number(s.imports.rows_invalid)}
              </p>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {t('imports.rowsNote')}
              </p>
            </li>
          </ul>
          <p className="muted">{t('home.generatedAt', { when: fmt.dateTime(new Date(s.generated_at), { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' }) })}</p>
        </>
      )}
      <h2>{t('imports.gapHeading')}</h2>
      <p>{t('imports.gap')}</p>
    </>
  );
}
