import { getFormatter, getTranslations } from 'next-intl/server';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import { auditFilterSchema } from '@/lib/schemas';
import { AUDIT_ACTIONS, listAudit } from '@/server/services/audit';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';
import { pageTitle } from '@/lib/metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'admin.auditTitle');
}

/** Audit log: filter by action, newest first. Read-only; the database (RLS on audit_log) decides which rows come back. */
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
        <PageHeader title={t('auditTitle')} />
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
      <PageHeader title={t('auditTitle')} sub={t('auditIntro')} />
      <form method="get" className="toolbar-x">
        <label htmlFor="action" className="sr">
          {t('filterLabel')}
        </label>
        <select id="action" name="action" defaultValue={action ?? ''} className="select-x" style={{ minWidth: '14rem' }}>
          <option value="">{t('filterAll')}</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          {t('filterApply')}
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon="list" title={t('empty')} text={t('auditIntro')} />
      ) : (
        <DataTable
          caption={t('auditTitle')}
          columns={[
            { key: 'when', label: t('when') },
            { key: 'action', label: t('action') },
            { key: 'who', label: t('who') },
            { key: 'details', label: t('details') },
          ]}
          rows={rows.map((r) => ({
            id: String(r.id),
            cells: {
              when: `${fmt.dateTime(new Date(r.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`,
              action: <code>{r.action}</code>,
              who: r.actor_user_id ? r.actor_user_id.slice(0, 8) : '-',
              details: <pre className="details">{JSON.stringify(r.details)}</pre>,
            },
          }))}
        />
      )}
    </>
  );
}
