import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireModerator } from '@/server/reviewer';
import { listListingQueue, type OwnerListing } from '@/server/services/directory';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminList.title');
}

const FILTERS = ['pending', 'live', 'suspended'] as const;
type Filter = (typeof FILTERS)[number];

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
        <h1>{t('adminList.title')}</h1>
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
      <h1>{t('adminList.title')}</h1>
      <p>{t('adminList.intro')}</p>
      <nav aria-label={t('adminList.filters')} className="link-row">
        {FILTERS.map((f) => (
          <Link key={f} href={`/admin/listings?status=${f}`} locale={locale} className={f === filter ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={f === filter ? 'page' : undefined}>
            {t(`adminList.filter.${f}`)}
          </Link>
        ))}
        <Link href="/admin/reports" locale={locale}>
          {t('adminList.reportsLink')}
        </Link>
        <Link href="/admin/reviews" locale={locale}>{t('p4.moderateReviews')}</Link>
        <Link href="/admin/duplicates" locale={locale}>
          {t('dupAdmin.title')}
        </Link>
      </nav>
      {items.length === 0 ? (
        <p>{t('adminList.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th scope="col">{t('adminList.business')}</th>
                <th scope="col">{t('adminList.when')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('adminList.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.org_id}>
                  <td data-label={t('adminList.business')}>{nameOf(l)}</td>
                  <td data-label={t('adminList.when')}>
                    {filter === 'pending' && l.submitted_at ? fmt.dateTime(new Date(l.submitted_at), { dateStyle: 'medium', timeZone: 'UTC' }) : fmt.dateTime(new Date(l.updated_at), { dateStyle: 'medium', timeZone: 'UTC' })}
                  </td>
                  <td>
                    <Link href={`/admin/listings/${l.org_id}`} locale={locale}>
                      {t('adminList.open')}
                    </Link>
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
