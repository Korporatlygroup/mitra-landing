import { getFormatter, getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import Pager from '@/components/admin-catalogue/Pager';
import { parseOffset } from '@/components/admin-catalogue/helpers';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { listSupplierReviews } from '@/server/services/p5-admin';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.suppliers.title');
}

export default async function AdminSuppliersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue/suppliers');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const all = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!ctx.canReviewSuppliers) return <NoAccess locale={locale} title={t('suppliers.title')} />;

  const scope = sp.scope === 'all' ? 'all' : 'pending';
  const offset = parseOffset(sp.offset);
  const res = await listSupplierReviews(ctx.session.supabase, scope, offset);
  const page = res.ok ? res.data : null;

  return (
    <>
      <h1>{t('suppliers.title')}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="suppliers" />
      <p>{t('suppliers.intro')}</p>
      <nav aria-label={t('suppliers.filters')} className="link-row">
        {(['pending', 'all'] as const).map((f) => (
          <Link
            key={f}
            href={f === 'pending' ? '/admin/catalogue/suppliers' : '/admin/catalogue/suppliers?scope=all'}
            locale={locale}
            className={f === scope ? 'btn btn-primary' : 'btn btn-secondary'}
            aria-current={f === scope ? 'page' : undefined}
          >
            {t(`suppliers.scope.${f}`)}
          </Link>
        ))}
      </nav>
      {!page ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {all(`errors.${res.ok ? 'invalid_input' : res.errorKey}`)}
        </p>
      ) : page.items.length === 0 ? (
        <p>{t('suppliers.empty')}</p>
      ) : (
        <ul className="card-list" data-testid="supplier-queue">
          {page.items.map((s) => (
            <li key={s.id} className="card" data-testid="supplier-card" data-supplier={s.id}>
              <h3>
                <Link href={`/admin/catalogue/suppliers/${s.id}`} locale={locale}>
                  {s.name ?? s.code}
                </Link>
              </h3>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={s.status} label={all(`p5common.status.supplier.${s.status}`)} />
                {s.draft_submitted_version !== null ? <span className="chip adm-count"> {t('suppliers.awaitingDecision')}</span> : null}
              </p>
              <dl className="dl">
                <dt>{t('suppliers.partner')}</dt>
                <dd>{s.partner_name ?? '-'}</dd>
                <dt>{t('suppliers.code')}</dt>
                <dd>{s.code}</dd>
                <dt>{t('suppliers.submittedOn')}</dt>
                <dd>{s.submitted_at ? fmt.dateTime(new Date(s.submitted_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', timeZoneName: 'short' }) : '-'}</dd>
              </dl>
              {s.conflict_of_interest ? (
                <p className="message message-error" role="note">
                  {t('common.conflict')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page ? <Pager locale={locale} base="/admin/catalogue/suppliers" offset={offset} total={page.total} params={scope === 'all' ? { scope: 'all' } : {}} /> : null}
    </>
  );
}
