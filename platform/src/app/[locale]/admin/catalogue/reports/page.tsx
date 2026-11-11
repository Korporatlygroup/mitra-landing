import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import CatalogueAdminNav from '@/components/admin-catalogue/CatalogueAdminNav';
import NoAccess from '@/components/admin-catalogue/NoAccess';
import Pager from '@/components/admin-catalogue/Pager';
import { parseOffset } from '@/components/admin-catalogue/helpers';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireCatalogueAdmin } from '@/server/catalogue-admin-context';
import { listProductReports } from '@/server/services/p5-admin';
import { handleReportAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5admin.reports.title');
}

const FILTERS = ['open', 'actioned', 'dismissed'] as const;
type Filter = (typeof FILTERS)[number];

export default async function AdminReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const ctx = await requireCatalogueAdmin(locale, '/admin/catalogue/reports');
  const t = await getTranslations({ locale, namespace: 'p5admin' });
  const all = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!ctx.canModerate) return <NoAccess locale={locale} title={t('reports.title')} />;

  const filter: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : 'open';
  const offset = parseOffset(sp.offset);
  const res = await listProductReports(ctx.session.supabase, filter, offset);
  const page = res.ok ? res.data : null;

  return (
    <>
      <h1>{t('reports.title')}</h1>
      <CatalogueAdminNav locale={locale} ctx={ctx} current="reports" />
      <p>{t('reports.intro')}</p>
      <nav aria-label={t('reports.filters')} className="link-row">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'open' ? '/admin/catalogue/reports' : `/admin/catalogue/reports?status=${f}`}
            locale={locale}
            className={f === filter ? 'btn btn-primary' : 'btn btn-secondary'}
            aria-current={f === filter ? 'page' : undefined}
          >
            {t(`reports.filter.${f}`)}
          </Link>
        ))}
      </nav>
      {!page ? (
        <p role="alert" className="message message-error">
          <strong>{t('common.error')}: </strong>
          {all(`errors.${res.ok ? 'invalid_input' : res.errorKey}`)}
        </p>
      ) : page.items.length === 0 ? (
        <p>{t(`reports.empty.${filter}`)}</p>
      ) : (
        <ul className="card-list" data-testid="report-queue">
          {page.items.map((r) => (
            <li key={r.id} className="card" data-testid="report-card" data-report={r.id}>
              <h3>
                {ctx.canReviewProducts ? (
                  <Link href={`/admin/catalogue/products/${r.product_id}`} locale={locale}>
                    {r.product_name ?? t('reports.unnamed')}
                  </Link>
                ) : (
                  (r.product_name ?? t('reports.unnamed'))
                )}
              </h3>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={r.status === 'actioned' ? 'approved' : 'pending'} label={t(`reports.status.${r.status}`)} />{' '}
                <span className="chip">{all(`p5common.reportReasons.${r.reason}`)}</span>
              </p>
              <dl className="dl">
                <dt>{t('reports.note')}</dt>
                <dd>{r.note || t('common.none')}</dd>
                <dt>{t('reports.productStatus')}</dt>
                <dd data-testid="report-product-status">{all(`p5common.status.product.${r.product_status}`)}</dd>
                <dt>{t('reports.supplier')}</dt>
                <dd>{r.supplier_name ?? '-'}</dd>
                <dt>{t('reports.received')}</dt>
                <dd>{fmt.dateTime(new Date(r.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', timeZoneName: 'short' })}</dd>
                {r.handler_note ? (
                  <>
                    <dt>{t('reports.handlerNote')}</dt>
                    <dd data-testid="report-handler-note">{r.handler_note}</dd>
                  </>
                ) : null}
              </dl>
              {r.status === 'open' ? (
                r.conflict_of_interest ? (
                  <p className="message message-error" role="note">
                    {t('common.conflict')}
                  </p>
                ) : (
                  <div className="adm-actions">
                    <details>
                      <summary>{t('reports.dismissSummary')}</summary>
                      <p className="hint">{t('reports.dismissHint')}</p>
                      <ActionForm action={handleReportAction} submitLabel={t('reports.dismissButton')} variant="secondary">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="reportId" value={r.id} />
                        <input type="hidden" name="action" value="dismiss" />
                        <TextArea id={`dis-${r.id}`} name="note" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
                      </ActionForm>
                    </details>
                    <details>
                      <summary>{t('reports.suspendSummary')}</summary>
                      <p className="hint">{t('reports.suspendHint')}</p>
                      <ActionForm action={handleReportAction} submitLabel={t('reports.suspendButton')} variant="danger">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="reportId" value={r.id} />
                        <input type="hidden" name="action" value="suspend_product" />
                        <TextArea id={`sus-${r.id}`} name="note" label={t('common.reasonLabel')} hint={t('common.reasonHint')} required maxLength={1000} />
                      </ActionForm>
                    </details>
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page ? <Pager locale={locale} base="/admin/catalogue/reports" offset={offset} total={page.total} params={filter === 'open' ? {} : { status: filter }} /> : null}
    </>
  );
}
