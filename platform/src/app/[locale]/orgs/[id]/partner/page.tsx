import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requirePartnerContext } from '@/server/partner-context';
import { listMyProducts, listMySuppliers, listPartnerRequests } from '@/server/services/p5-partner';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.home');
}

/** Partner home: real counts from the database and the four things a partner does most. */
export default async function PartnerHomePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;

  const t = await getTranslations({ locale, namespace: 'p5partner.home' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const db = ctx.session.supabase;
  const [suppliers, published, awaiting, correction, requests] = await Promise.all([
    listMySuppliers(db, id),
    listMyProducts(db, id, { status: 'published', limit: 1 }),
    listMyProducts(db, id, { status: 'submitted', limit: 1 }),
    listMyProducts(db, id, { status: 'changes_requested', limit: 1 }),
    listPartnerRequests(db, id, 'submitted', 0),
  ]);
  const sup = suppliers.ok ? suppliers.data.items : [];
  const stats: { key: string; value: number | null; href: string }[] = [
    { key: 'suppliersTotal', value: suppliers.ok ? sup.length : null, href: `/orgs/${id}/partner/suppliers` },
    { key: 'suppliersApproved', value: suppliers.ok ? sup.filter((s) => s.status === 'approved').length : null, href: `/orgs/${id}/partner/suppliers` },
    { key: 'productsPublished', value: published.ok ? published.data.total : null, href: `/orgs/${id}/partner/products?status=published` },
    { key: 'productsAwaiting', value: awaiting.ok ? awaiting.data.total : null, href: `/orgs/${id}/partner/products?status=submitted` },
    { key: 'productsCorrection', value: correction.ok ? correction.data.total : null, href: `/orgs/${id}/partner/products?status=changes_requested` },
    { key: 'requestsNew', value: requests.ok ? requests.data.total : null, href: `/orgs/${id}/partner/requests?status=submitted` },
    {
      key: 'suppliersCorrection',
      value: suppliers.ok ? sup.filter((s) => s.status === 'more_info_needed' || s.status === 'rejected').length : null,
      href: `/orgs/${id}/partner/suppliers`,
    },
  ];
  const approvedSuppliers = sup.filter((s) => s.status === 'approved').length;
  const next = sup.length === 0 ? 'addSupplier' : approvedSuppliers === 0 ? 'waitSupplier' : null;

  return (
    <>
      <h1>{t('title', { name: ctx.profile?.display_name ?? ctx.org.name })}</h1>
      <p className="muted">{t('intro')}</p>

      {next ? (
        <p className="next-step" data-testid="next-step">
          {t(`next.${next}`)}
        </p>
      ) : null}

      <h2>{t('actionsTitle')}</h2>
      <ul className="p5-grid" aria-label={t('actionsTitle')}>
        <li>
          <Link className="big-link" href={`/orgs/${id}/partner/suppliers/new`} locale={locale}>
            {tc('buttons.addSupplier')}
          </Link>
        </li>
        <li>
          <Link className="big-link" href={`/orgs/${id}/partner/products/new`} locale={locale}>
            {tc('buttons.addProduct')}
          </Link>
        </li>
        <li>
          <Link className="big-link" href={`/orgs/${id}/partner/import`} locale={locale}>
            {t('uploadCatalogue')}
          </Link>
        </li>
        <li>
          <Link className="big-link" href={`/orgs/${id}/partner/requests`} locale={locale}>
            {tc('buttons.viewRequests')}
          </Link>
        </li>
      </ul>

      <h2>{t('countsTitle')}</h2>
      <ul className="p5-grid" aria-label={t('countsTitle')}>
        {stats.map((s) => (
          <li key={s.key} className="card" data-testid={`stat-${s.key}`}>
            <p className="p5-stat" style={{ margin: 0 }}>
              {s.value ?? '-'}
            </p>
            <p style={{ margin: 0 }}>
              <Link href={s.href} locale={locale}>
                {t(`stats.${s.key}`)}
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
