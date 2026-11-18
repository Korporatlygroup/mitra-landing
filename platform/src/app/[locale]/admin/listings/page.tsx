import { getFormatter, getTranslations } from 'next-intl/server';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import TabsNav from '@/components/shared/TabsNav';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireModerator } from '@/server/reviewer';
import { listListingQueue, type OwnerListing } from '@/server/services/directory';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminList.title');
}

const FILTERS = ['pending', 'live', 'suspended'] as const;
type Filter = (typeof FILTERS)[number];

/** Listing moderation: tabs per state, a table, and links to the related queues (reports, reviews, duplicates). */
export default async function AdminListingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { session, canReviewListings } = await requireModerator(locale, '/admin/listings');
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  if (!canReviewListings) {
    return (
      <>
        <PageHeader title={t('adminList.title')} />
        <p role="alert" className="message message-error">
          {t('adminList.noAccess')}
        </p>
      </>
    );
  }
  const filter: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : 'pending';
  const items = await listListingQueue(session.supabase, filter);
  const nameOf = (l: OwnerListing) => l.draft.profile?.business_name ?? l.live_name ?? '-';

  return (
    <>
      <PageHeader
        title={t('adminList.title')}
        sub={t('adminList.intro')}
        actions={
          <>
            <Link href="/admin/reports" locale={locale} className="btn btn-secondary btn-sm">
              {t('adminList.reportsLink')}
            </Link>
            <Link href="/admin/reviews" locale={locale} className="btn btn-secondary btn-sm">
              {t('p4.moderateReviews')}
            </Link>
            <Link href="/admin/duplicates" locale={locale} className="btn btn-secondary btn-sm">
              {t('dupAdmin.title')}
            </Link>
          </>
        }
      />
      <TabsNav label={t('adminList.filters')} items={FILTERS.map((f) => ({ href: `/admin/listings?status=${f}`, label: t(`adminList.filter.${f}`), active: f === filter }))} />
      {items.length === 0 ? (
        <EmptyState icon="store" title={t('adminList.empty')} text={t('adminList.intro')} />
      ) : (
        <DataTable
          caption={t('adminList.title')}
          columns={[
            { key: 'business', label: t('adminList.business') },
            { key: 'when', label: t('adminList.when') },
            { key: 'action', label: t('adminList.open') },
          ]}
          rows={items.map((l) => ({
            id: l.org_id,
            cells: {
              business: <strong>{nameOf(l)}</strong>,
              when: fmt.dateTime(new Date(filter === 'pending' && l.submitted_at ? l.submitted_at : l.updated_at), { dateStyle: 'medium', timeZone: 'UTC' }),
              action: (
                <Link href={`/admin/listings/${l.org_id}`} locale={locale} className="btn btn-secondary btn-sm">
                  {t('adminList.open')}
                </Link>
              ),
            },
          }))}
        />
      )}
    </>
  );
}
