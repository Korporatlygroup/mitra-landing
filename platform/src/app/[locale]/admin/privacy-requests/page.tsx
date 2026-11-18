import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { pageTitle } from '@/lib/metadata';
import { adminListPrivacyRequests } from '@/server/services/privacy';
import { requireSession } from '@/server/session';
import { handlePrivacyRequestAction } from './actions';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'account.requestsAdminTitle');
}

export default async function AdminPrivacyRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/admin/privacy-requests' });
  const t = await getTranslations({ locale, namespace: 'account' });
  const a = await getTranslations({ locale, namespace: 'admin' });
  const list = await adminListPrivacyRequests(s.supabase, 'open');
  const inProgress = await adminListPrivacyRequests(s.supabase, 'in_progress');
  if (!list.ok) {
    return (
      <>
        <PageHeader title={t('requestsAdminTitle')} />
        <p role="alert" className="message message-error">
          {a('noAccess')}
        </p>
      </>
    );
  }
  const rows = [...list.data, ...(inProgress.ok ? inProgress.data : [])];
  return (
    <>
      <PageHeader title={t('requestsAdminTitle')} sub={t('requestsAdminIntro')} />
      {rows.length === 0 ? <p>{t('requestsNone')}</p> : null}
      {rows.map((r) => (
        <section key={r.id} className="card" data-testid="privacy-request">
          <h2>
            {t(`requestTypes.${r.request_type}`)} — {t(`requestStatus.${r.status}`)}
            {r.overdue ? <> ({t('requestOverdue')})</> : null}
          </h2>
          <p>
            {r.requester_email ?? '—'} · {t('requestDue')} {r.due_at.slice(0, 10)}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.details}</p>
          <ActionForm action={handlePrivacyRequestAction} submitLabel={t('requestUpdate')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={r.id} />
            <div className="field">
              <label htmlFor={`status-${r.id}`}>{t('requestStatusLabel')}</label>
              <select id={`status-${r.id}`} name="status" defaultValue="completed">
                <option value="in_progress">{t('requestStatus.in_progress')}</option>
                <option value="completed">{t('requestStatus.completed')}</option>
                <option value="rejected">{t('requestStatus.rejected')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`note-${r.id}`}>{t('requestAnswer')}</label>
              <textarea id={`note-${r.id}`} name="note" maxLength={2000} rows={3} />
            </div>
          </ActionForm>
        </section>
      ))}
    </>
  );
}
