import { getFormatter, getTranslations } from 'next-intl/server';
import { auditFilterSchema } from '@/lib/schemas';
import { AUDIT_ACTIONS, listAudit } from '@/server/services/audit';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'admin.auditTitle');
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  // Admins are sent through MFA by requireSession; owners of ordinary organisations are not.
  const s = await requireSession({ locale, path: '/admin/audit' });
  const t = await getTranslations({ locale, namespace: 'admin' });
  const fmt = await getFormatter({ locale });

  // UI hint only: the database (RLS on audit_log) decides which rows come back.
  const roles = [...new Set(s.memberships.map((m) => m.role))];
  const canRead = (await Promise.all(roles.map((r) => getRolePermissions(s.supabase, r)))).some((p) => p.has('audit:read'));
  if (!canRead) {
    return (
      <>
        <h1>{t('auditTitle')}</h1>
        <p role="alert" className="message message-error">
          {t('noAccess')}
        </p>
      </>
    );
  }

  const filter = auditFilterSchema.safeParse({ action: typeof sp.action === 'string' && sp.action ? sp.action : undefined });
  const action = filter.success ? filter.data.action : undefined;
  const rows = await listAudit(s.supabase, action);

  return (
    <>
      <h1>{t('auditTitle')}</h1>
      <p>{t('auditIntro')}</p>
      <form method="get" className="inline-form">
        <div className="field">
          <label htmlFor="action">{t('filterLabel')}</label>
          <select id="action" name="action" defaultValue={action ?? ''}>
            <option value="">{t('filterAll')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          {t('filterApply')}
        </button>
      </form>
      {rows.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th scope="col">{t('when')}</th>
                <th scope="col">{t('action')}</th>
                <th scope="col">{t('who')}</th>
                <th scope="col">{t('details')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('when')}>{fmt.dateTime(new Date(r.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</td>
                  <td data-label={t('action')}>{r.action}</td>
                  <td data-label={t('who')}>{r.actor_user_id ? r.actor_user_id.slice(0, 8) : '-'}</td>
                  <td data-label={t('details')}>
                    <pre className="details">{JSON.stringify(r.details)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
