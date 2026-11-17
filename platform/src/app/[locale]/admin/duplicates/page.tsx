import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireModerator } from '@/server/reviewer';
import { listDuplicateFlags } from '@/server/services/directory';
import { resolveDuplicateAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'dupAdmin.title');
}

/** Possible duplicate businesses: both records side by side with the reason, and the two possible decisions (each with an optional note). */
export default async function AdminDuplicatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { session } = await requireModerator(locale, '/admin/duplicates');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const r = await listDuplicateFlags(session.supabase, 'open');
  const back = (
    <Link href="/admin/listings" locale={locale} className="btn btn-secondary">
      {t('adminList.title')}
    </Link>
  );
  if (!r.ok) {
    return (
      <>
        <PageHeader title={t('dupAdmin.title')} actions={back} />
        <p role="alert" className="message message-error">
          {t('adminList.noAccess')}
        </p>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('dupAdmin.title')} sub={t('dupAdmin.intro')} actions={back} />
      {r.data.length === 0 ? (
        <EmptyState icon="users" title={t('dupAdmin.none')} text={t('dupAdmin.intro')} />
      ) : (
        <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.data.map((f) => (
            <li key={f.id} className="rrow">
              <div className="rrow-top">
                <h3>
                  <Link href={`/admin/listings/${f.org_id}`} locale={locale}>
                    {f.org_name}
                  </Link>{' '}
                  &harr;{' '}
                  <Link href={`/admin/listings/${f.other_org_id}`} locale={locale}>
                    {f.other_org_name}
                  </Link>
                </h3>
                <StatusBadge label={t(f.reason === 'ssm' ? 'dupAdmin.reasonSsm' : 'dupAdmin.reasonName')} tone="gold" />
              </div>
              <div className="meta">
                <span>{fmt.dateTime(new Date(f.created_at), { dateStyle: 'medium' })}</span>
              </div>
              <div className="xgrid xgrid-2">
                {(['dismiss', 'confirm'] as const).map((d) => (
                  <ActionForm key={d} action={resolveDuplicateAction} submitLabel={t(d === 'dismiss' ? 'dupAdmin.dismiss' : 'dupAdmin.confirm')} variant="secondary">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="flagId" value={f.id} />
                    <input type="hidden" name="decision" value={d} />
                    <Field id={`note-${f.id}-${d}`} name="note" label={t('dupAdmin.note')} maxLength={1000} />
                  </ActionForm>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
