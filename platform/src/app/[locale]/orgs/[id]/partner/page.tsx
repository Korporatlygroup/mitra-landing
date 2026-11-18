import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requirePartnerContext } from '@/server/partner-context';
import { listMyProducts, listMySuppliers, listPartnerRequests } from '@/server/services/p5-partner';
import PageHeader from '@/components/shared/PageHeader';
import Icon from '@/components/ui/Icon';

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
  const t6 = await getTranslations({ locale, namespace: 'p6' });
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
      <PageHeader title={t('title', { name: ctx.profile?.display_name ?? ctx.org.name })} sub={t('intro')} />

      {next ? (
        <p className="acard" data-testid="next-step" style={{ marginBottom: 20, borderColor: 'var(--brand)', background: 'var(--brand-tint)' }}>
          {t(`next.${next}`)}
        </p>
      ) : null}

      <div className="sechead">
        <h2>{t('actionsTitle')}</h2>
      </div>
      <ul className="xgrid xgrid-3" aria-label={t('actionsTitle')} style={{ listStyle: 'none', padding: 0, margin: '0 0 28px' }}>
        {(
          [
            { href: `/orgs/${id}/partner/suppliers/new`, icon: 'store', label: tc('buttons.addSupplier') },
            { href: `/orgs/${id}/partner/products/new`, icon: 'box', label: tc('buttons.addProduct') },
            { href: `/orgs/${id}/partner/import`, icon: 'upload', label: t('uploadCatalogue') },
            { href: `/orgs/${id}/partner/requests`, icon: 'board', label: tc('buttons.viewRequests') },
            { href: `/orgs/${id}/partner/sourcing`, icon: 'layers', label: t6('partnerRequests') },
          ] as const
        ).map((x) => (
          <li key={x.href}>
            <Link className="dcard big-link" href={x.href} locale={locale}>
              <span className="dcard-ico" aria-hidden="true">
                <Icon name={x.icon} size={22} />
              </span>
              <h3>{x.label}</h3>
              <span className="dcard-go">
                <Icon name="forward" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="sechead">
        <h2>{t('countsTitle')}</h2>
      </div>
      <ul className="xgrid-m" aria-label={t('countsTitle')} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {stats.map((s) => (
          <li key={s.key} data-testid={`stat-${s.key}`}>
            <Link href={s.href} locale={locale} className="mcard mcard-link">
              <b>{s.value ?? '-'}</b>
              <span>{t(`stats.${s.key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
