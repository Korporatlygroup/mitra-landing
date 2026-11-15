import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import AdminHelpNav from '../../AdminHelpNav';
import ProgrammeForm, { type FormSource } from '../../ProgrammeForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.manual.title');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Adds a programme by hand from an official page. It is only proposed here: a different administrator approves it. */
export default async function NewProgrammePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ source?: string; info?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const ctx = await requireGovAdmin(locale, '/admin/business-help/programmes/new');
  if (!ctx.canView || !ctx.canReview) notFound();
  const t = await getTranslations({ locale, namespace: 'gov.admin' });
  const { data } = await ctx.session.supabase.from('gov_sources').select('id, name, allowed_hosts').eq('source_type', 'manual').order('name');
  const sources = (data ?? []) as FormSource[];
  const defaultSourceId = sp.source && UUID.test(sp.source) ? sp.source : undefined;
  // A link from the page-changes queue pre-fills the official page; the form and the database check it again.
  const info = sp.info && /^https:\/\/\S{1,480}$/.test(sp.info) ? sp.info : undefined;

  return (
    <>
      <h1>{t('manual.title')}</h1>
      <AdminHelpNav locale={locale} current="newProgramme" canReview={ctx.canReview} />
      <p>{t('manual.intro')}</p>
      <p role="note" className="card">
        {t('manual.notice')}
      </p>
      {sources.length === 0 ? (
        <p role="status">
          {t('manual.noSource')}{' '}
          {ctx.canSources ? (
            <Link href="/admin/business-help/sources" locale={locale}>
              {t('nav.sources')}
            </Link>
          ) : null}
        </p>
      ) : (
        <ProgrammeForm locale={locale} sources={sources} defaultSourceId={defaultSourceId} initial={info ? { info_url: info } : {}} />
      )}
    </>
  );
}
