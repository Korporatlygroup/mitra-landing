import { getFormatter, getTranslations } from 'next-intl/server';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import { humanDuration, percent } from '@/components/admin-catalogue/helpers';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { catalogueStats } from '@/server/services/p5-admin';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.home.title');
}

export default async function AdminCatalogueHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const fmt = await getFormatter({ locale });
  if (!ctx.any) return <NoAccess locale={locale} title={t('home.title')} />;

  const stats = ctx.canStats ? await catalogueStats(ctx.session.supabase) : null;
  const s = stats && stats.ok ? stats.data : null;
  const num = (n: number) => fmt.number(n);
  const pr = s?.partner_response;
  const median = pr?.median_response_seconds != null ? humanDuration(pr.median_response_seconds) : null;

  const tiles: { key: string; label: string; value: string; note?: string; testid: string }[] = s
    ? [
        { key: 'approvedSuppliers', label: t('home.stats.approvedSuppliers'), value: num(s.approved_suppliers), testid: 'stat-approved-suppliers' },
        { key: 'publishedProducts', label: t('home.stats.publishedProducts'), value: num(s.published_products), testid: 'stat-published-products' },
        { key: 'suppliersAwaiting', label: t('home.stats.suppliersAwaiting'), value: num(s.suppliers_awaiting_review), testid: 'stat-suppliers-awaiting' },
        { key: 'productsAwaiting', label: t('home.stats.productsAwaiting'), value: num(s.products_awaiting_review), testid: 'stat-products-awaiting' },
        { key: 'outdated', label: t('home.stats.outdated'), value: num(s.outdated_availability), note: t('home.stats.outdatedNote'), testid: 'stat-outdated' },
        { key: 'openReports', label: t('home.stats.openReports'), value: num(s.open_product_reports), testid: 'stat-open-reports' },
        { key: 'requests', label: t('home.stats.requests'), value: num(s.enquiries_received), testid: 'stat-requests' },
        { key: 'requests30d', label: t('home.stats.requests30d'), value: num(s.enquiries_received_30d), testid: 'stat-requests-30d' },
        {
          key: 'responseRate',
          label: t('home.stats.responseRate'),
          value: pr && pr.response_rate !== null ? `${percent(pr.response_rate)}%` : t('home.notEnough'),
          note: pr && pr.response_rate !== null ? t('home.stats.responseRateNote', { responded: pr.responded, requests: pr.requests }) : t('home.stats.noRequestsYet'),
          testid: 'stat-response-rate',
        },
        {
          key: 'median',
          label: t('home.stats.median'),
          value: median ? t(`home.duration.${median.unit}`, { n: median.value }) : t('home.notEnough'),
          note: median ? t('home.stats.medianNote') : t('home.stats.noResponsesYet'),
          testid: 'stat-median',
        },
        { key: 'importFailed', label: t('home.stats.importJobsFailed'), value: num(s.imports.jobs_failed), testid: 'stat-import-failed' },
        { key: 'importRows', label: t('home.stats.importRowsInvalid'), value: num(s.imports.rows_invalid), testid: 'stat-import-rows' },
      ]
    : [];

  const queues: { href: string; label: string; hint: string; count?: number; show: boolean; testid: string }[] = [
    { href: '/admin/catalogue/partners', label: t('home.queues.partners'), hint: t('home.queues.partnersHint'), show: ctx.canManagePartners, testid: 'link-partners' },
    { href: '/admin/catalogue/suppliers', label: t('home.queues.suppliers'), hint: t('home.queues.suppliersHint'), count: s?.suppliers_awaiting_review, show: ctx.canReviewSuppliers, testid: 'link-suppliers' },
    { href: '/admin/catalogue/products', label: t('home.queues.products'), hint: t('home.queues.productsHint'), count: s?.products_awaiting_review, show: ctx.canReviewProducts, testid: 'link-products' },
    { href: '/admin/catalogue/reports', label: t('home.queues.reports'), hint: t('home.queues.reportsHint'), count: s?.open_product_reports, show: ctx.canModerate, testid: 'link-reports' },
    { href: '/admin/catalogue/imports', label: t('home.queues.imports'), hint: t('home.queues.importsHint'), count: s?.imports.jobs_failed, show: ctx.canStats, testid: 'link-imports' },
  ];

  return (
    <>
      <PageHeader title={t('home.title')} />
      <CatalogueAdminNav locale={locale} ctx={ctx} current="home" />
      <p>{t('home.intro')}</p>

      <h2>{t('home.queuesHeading')}</h2>
      <ul className="card-list">
        {queues
          .filter((q) => q.show)
          .map((q) => (
            <li key={q.href} className="card">
              <h3>
                <Link href={q.href} locale={locale} data-testid={q.testid}>
                  {q.label}
                </Link>
                {q.count !== undefined ? <span className="chip adm-count"> {num(q.count)}</span> : null}
              </h3>
              <p className="muted" style={{ margin: 0 }}>
                {q.hint}
              </p>
            </li>
          ))}
      </ul>

      <h2>{t('home.statsHeading')}</h2>
      {!ctx.canStats ? (
        <p className="muted">{t('home.noStatsAccess')}</p>
      ) : !s ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {t('home.statsFailed')}
        </p>
      ) : (
        <>
          <p className="muted">
            {t('home.generatedAt', { when: fmt.dateTime(new Date(s.generated_at), { dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC' }) })}
          </p>
          <ul className="adm-stats">
            {tiles.map((x) => (
              <li key={x.key} className="card" data-testid={x.testid}>
                <p className="muted" style={{ margin: 0 }}>
                  {x.label}
                </p>
                <p className="p5-stat" style={{ margin: '4px 0' }} data-testid={`${x.testid}-value`}>
                  {x.value}
                </p>
                {x.note ? (
                  <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                    {x.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted">{t('home.statsNote')}</p>
        </>
      )}
    </>
  );
}
