import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import AdminHelpNav from '../../../AdminHelpNav';
import ProgrammeForm, { type FormInitial } from '../../../ProgrammeForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.manual.titleEdit');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A change to a published programme, proposed from its current published version. The published version stays until a second administrator approves. */
export default async function EditProgrammePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireGovAdmin(locale, `/admin/business-help/programmes/${id}/edit`);
  if (!ctx.canView || !ctx.canReview) notFound();
  const t = await getTranslations({ locale, namespace: 'gov.admin' });
  const db = ctx.session.supabase;
  const { data: prog } = await db.from('gov_programmes').select('id, source_id, name, current_version_id, publication_state').eq('id', id).maybeSingle();
  if (!prog) notFound();
  const { data: ver } = prog.current_version_id
    ? await db.from('gov_programme_versions').select('version_no, data').eq('id', prog.current_version_id).maybeSingle()
    : { data: null };

  return (
    <>
      <PageHeader title={t('manual.titleEdit')} />
      <AdminHelpNav locale={locale} current="home" canReview={ctx.canReview} />
      <p>
        <Link href="/admin/business-help" locale={locale}>
          {t('manual.back')}
        </Link>
      </p>
      {!ver || prog.publication_state === 'archived' ? (
        <p role="status">{t('manual.noProgramme')}</p>
      ) : (
        <>
          <h2>{prog.name ?? ''}</h2>
          <p>{t('manual.current', { version: ver.version_no })}</p>
          <p role="note" className="card">
            {t('manual.notice')}
          </p>
          <ProgrammeForm locale={locale} sources={[]} fixedSourceId={prog.source_id} programmeId={prog.id} initial={ver.data as FormInitial} />
        </>
      )}
    </>
  );
}
