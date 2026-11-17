import { getFormatter, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireModerator } from '@/server/reviewer';
import { listDuplicateFlags } from '@/server/services/directory';
import { resolveDuplicateAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'dupAdmin.title');
}

export default async function AdminDuplicatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { session } = await requireModerator(locale, '/admin/duplicates');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const r = await listDuplicateFlags(session.supabase, 'open');
  if (!r.ok) {
    return (
      <>
        <h1>{t('dupAdmin.title')}</h1>
        <p role="alert" className="message message-error">
          {t('adminList.noAccess')}
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        <Link href="/admin/listings" locale={locale}>
          {t('adminList.title')}
        </Link>
      </p>
      <h1>{t('dupAdmin.title')}</h1>
      <p>{t('dupAdmin.intro')}</p>
      {r.data.length === 0 ? (
        <p>{t('dupAdmin.none')}</p>
      ) : (
        <ul className="card-list">
          {r.data.map((f) => (
            <li key={f.id} className="card">
              <p style={{ marginTop: 0 }}>
                <strong>{f.org_name}</strong> &harr; <strong>{f.other_org_name}</strong>
              </p>
              <p className="muted">
                {t(f.reason === 'ssm' ? 'dupAdmin.reasonSsm' : 'dupAdmin.reasonName')} &middot; {fmt.dateTime(new Date(f.created_at), { dateStyle: 'medium' })}
              </p>
              <p className="link-row">
                <Link href={`/admin/listings/${f.org_id}`} locale={locale}>
                  {f.org_name}
                </Link>
                <Link href={`/admin/listings/${f.other_org_id}`} locale={locale}>
                  {f.other_org_name}
                </Link>
              </p>
              {(['dismiss', 'confirm'] as const).map((d) => (
                <ActionForm key={d} action={resolveDuplicateAction} submitLabel={t(d === 'dismiss' ? 'dupAdmin.dismiss' : 'dupAdmin.confirm')} variant="secondary">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="flagId" value={f.id} />
                  <input type="hidden" name="decision" value={d} />
                  <Field id={`note-${f.id}-${d}`} name="note" label={t('dupAdmin.note')} maxLength={1000} />
                </ActionForm>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
