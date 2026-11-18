import { getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listMySuppliers } from '@/server/services/p5-partner';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.suppliers');
}

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requirePartnerContext(locale, id, '/suppliers');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.suppliers' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const r = await listMySuppliers(ctx.session.supabase, id);
  const te = await getTranslations({ locale, namespace: 'errors' });
  const items = r.ok ? r.data.items : [];
  const base = `/orgs/${id}/partner/suppliers`;
  return (
    <>
      <PageHeader title={t('title')} sub={t('intro')} />
      {ctx.canManageSuppliers ? (
        <p>
          <Link href={`${base}/new`} locale={locale} className="btn btn-primary">
            {tc('buttons.addSupplier')}
          </Link>
        </p>
      ) : (
        <p className="hint">{t('readOnly')}</p>
      )}
      {!r.ok ? <p className="message message-error" role="alert">{te(r.errorKey)}</p> : null}
      {r.ok && items.length === 0 ? (
        <section>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
        </section>
      ) : (
        <ul className="card-list">
          {items.map((s) => {
            const attention = s.status === 'more_info_needed' || s.status === 'rejected';
            const revision = s.status === 'approved' && s.draft_submitted_version != null;
            return (
              <li key={s.id} className="card" data-testid="supplier-row">
                <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>
                  <Link href={`${base}/${s.id}`} locale={locale}>
                    {s.name ?? t('unnamed')}
                  </Link>
                </h2>
                <p style={{ margin: '0 0 6px' }}>
                  <StatusChip status={statusTone(s.status)} label={tc(`status.supplier.${s.status}`)} />
                  <span className="muted">
                    {' '}
                    &middot; {t('code')}: {s.code}
                  </span>
                </p>
                {attention ? <p className="message message-error">{t('needsAttention')}</p> : null}
                {revision ? <p className="hint">{t('revisionInReview')}</p> : null}
                {s.has_unsubmitted_changes && !revision ? <p className="hint">{t('unsentChanges')}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
