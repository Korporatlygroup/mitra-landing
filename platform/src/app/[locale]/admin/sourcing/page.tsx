import { getTranslations } from 'next-intl/server';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { sourcingOperations } from '@/server/services/p6-sourcing';

export default async function SourcingOperationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireCatalogueAdmin(locale, '/admin/sourcing');
  const t = await getTranslations({ locale, namespace: 'p6' });
  if (!ctx.canStats) return <p>{t('noAccess')}</p>;
  const result = await sourcingOperations(ctx.session.supabase);
  if (!result.ok) return <p role="alert">{t('loadFailed')}</p>;
  const report = result.data;
  return <div className="container">
    <h1>{t('operations')}</h1>
    <dl className="card">
      <dt>{t('allRequests')}</dt><dd>{report.total_requests}</dd>
      <dt>{t('status.awaiting_quotes')}</dt><dd>{report.awaiting_quotes}</dd>
      <dt>{t('status.preferred_selected')}</dt><dd>{report.preferred_selected}</dd>
    </dl>
    <h2>{t('myRequests')}</h2>
    <ul className="card-list">{report.items.map((item) =>
      <li className="card" key={item.id}>{item.reference} · {t(`status.${item.status as 'submitted'}`)}</li>)}</ul>
  </div>;
}
