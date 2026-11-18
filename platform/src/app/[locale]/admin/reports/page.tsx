import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { SelectField } from '@/components/Field';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireModerator } from '@/server/reviewer';
import { getRequestForModeration, listOpenReports } from '@/server/services/directory';
import { handleReportAction } from '../listings/actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminList.reportsTitle');
}

export default async function AdminReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { session, canReviewListings, canModerateRequests } = await requireModerator(locale, '/admin/reports');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!canReviewListings && !canModerateRequests) {
    return (
      <>
        <PageHeader title={t('adminList.reportsTitle')} />
        <p role="alert" className="message message-error">
          {t('adminList.noAccess')}
        </p>
      </>
    );
  }
  const reports = await listOpenReports(session.supabase);
  const cards = await Promise.all(
    reports.map(async (r) => ({ r, req: r.request_id && canModerateRequests ? await getRequestForModeration(session.supabase, r.request_id) : null })),
  );

  return (
    <>
      <PageHeader
        title={t('adminList.reportsTitle')}
        sub={t('adminList.reportsIntro')}
        actions={
          <Link href="/admin/listings" locale={locale} className="btn btn-secondary">
            {t('adminList.title')}
          </Link>
        }
      />
      {cards.length === 0 ? (
        <EmptyState icon="flag" title={t('adminList.noReports')} text={t('adminList.reportsIntro')} />
      ) : (
        <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {cards.map(({ r, req }) => (
            <li key={r.id} className="rrow" data-testid="report-card">
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                {r.target_type === 'listing' ? t('adminList.reportListing') : t('adminList.reportRequest')} · {t(`rep.reasons.${r.reason}`)}
              </h2>
              <p className="muted">{fmt.dateTime(new Date(r.created_at), { dateStyle: 'medium', timeZone: 'UTC' })}</p>
              {r.note ? <p>{r.note}</p> : null}
              {r.listing_org_id ? (
                <p>
                  <Link href={`/admin/listings/${r.listing_org_id}`} locale={locale}>
                    {t('adminList.openListing')}
                  </Link>
                </p>
              ) : null}
              {req ? (
                <div className="card">
                  <strong>{req.title}</strong>
                  <p style={{ whiteSpace: 'pre-line', margin: '4px 0 0' }}>{req.description}</p>
                </div>
              ) : null}
              <ActionForm action={handleReportAction} submitLabel={t('adminList.reportSave')}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reportId" value={r.id} />
                <SelectField id={`act-${r.id}`} name="action" label={t('adminList.reportAction')} defaultValue="dismiss">
                  <option value="dismiss">{t('adminList.actions.dismiss')}</option>
                  {r.target_type === 'listing' ? <option value="suspend">{t('adminList.actions.suspend')}</option> : <option value="remove">{t('adminList.actions.remove')}</option>}
                </SelectField>
                <div className="field">
                  <label htmlFor={`note-${r.id}`}>{t('adminList.reason')}</label>
                  <textarea id={`note-${r.id}`} name="note" rows={2} required minLength={5} maxLength={1000} />
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
