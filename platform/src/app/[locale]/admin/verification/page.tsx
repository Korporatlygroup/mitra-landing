import { getTranslations } from 'next-intl/server';
import ClaimReview from '@/components/admin/ClaimReview';
import RouteDrawer from '@/components/admin/RouteDrawer';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/shared/StatusBadge';
import TabsNav from '@/components/shared/TabsNav';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { claimStatusFilterSchema, uuidSchema } from '@/lib/schemas';
import { requireReviewer } from '@/server/reviewer';
import { listQueue, queueCounts } from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminVer.title');
}

const STATUSES = ['submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale', 'withdrawn'] as const;
const TONE: Record<string, BadgeTone> = { submitted: 'brand', in_review: 'gold', needs_info: 'gold', approved: 'green', rejected: 'red', stale: 'red', withdrawn: 'neutral' };

/** Business verification queue: status tabs with counts, a table of claims (oldest waiting highlighted), and the review in a drawer so the list stays in view. */
export default async function AdminVerificationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const { session, canReview, canDecide } = await requireReviewer(locale, '/admin/verification');
  const t = await getTranslations({ locale });

  if (!canReview) {
    return (
      <>
        <PageHeader title={t('adminVer.title')} />
        <p role="alert" className="message message-error">
          {t('adminVer.noAccess')}
        </p>
      </>
    );
  }

  const parsed = claimStatusFilterSchema.safeParse(typeof sp.status === 'string' ? sp.status : 'open');
  const filter = parsed.success ? parsed.data : 'open';
  const claimParam = uuidSchema.safeParse(sp.claim);
  const [items, counts] = await Promise.all([listQueue(session.supabase, filter), queueCounts(session.supabase)]);
  const openCount = (counts.submitted ?? 0) + (counts.in_review ?? 0);
  const closeHref = `/admin/verification?status=${filter}`;

  return (
    <>
      <PageHeader title={t('adminVer.title')} sub={t('adm2.queueSub')} />

      <TabsNav
        label={t('adminVer.filterLabel')}
        items={[
          { href: '/admin/verification?status=open', label: t('adminVer.filterOpen'), count: openCount, active: filter === 'open' },
          ...STATUSES.map((s) => ({ href: `/admin/verification?status=${s}`, label: t(`claimStatus.${s}`), count: counts[s] ?? 0, active: filter === s })),
          { href: '/admin/verification?status=all', label: t('adminVer.filterAll'), active: filter === 'all' },
        ]}
      />

      {items.length === 0 ? (
        <EmptyState icon="shield" title={t('adminVer.empty')} text={t('adm2.queueSub')} />
      ) : (
        <DataTable
          caption={t('adminVer.title')}
          columns={[
            { key: 'business', label: t('adminVer.business') },
            { key: 'claim', label: t('adminVer.claim') },
            { key: 'status', label: t('adminVer.status') },
            { key: 'waiting', label: t('adm2.waiting') },
            { key: 'action', label: t('adm2.review') },
          ]}
          rows={items.map((c) => ({
            id: c.id,
            highlight: claimParam.success && claimParam.data === c.id,
            cells: {
              business: <strong>{c.org_name}</strong>,
              claim: t(`claimTypes.${c.claim_type}`),
              status: <StatusBadge label={t(`claimStatus.${c.status}`)} tone={TONE[c.status] ?? 'neutral'} />,
              waiting:
                c.age_days === null ? (
                  '-'
                ) : (
                  <span style={c.age_days >= 3 ? { color: 'var(--tag-coral)', fontWeight: 700 } : undefined}>{t('adminVer.ageDays', { days: c.age_days })}</span>
                ),
              action: (
                <Link href={`/admin/verification?status=${filter}&claim=${c.id}`} className="btn btn-secondary btn-sm" aria-label={`${t('adm2.review')}: ${c.org_name}`}>
                  {t('adm2.review')}
                </Link>
              ),
            },
          }))}
        />
      )}

      {claimParam.success ? (
        <RouteDrawer title={t('adminVer.title')} closeHref={closeHref}>
          <ClaimReview claimId={claimParam.data} locale={locale} db={session.supabase} canDecide={canDecide} />
          <Link href={`/admin/verification/${claimParam.data}`} className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
            {t('adm2.fullPage')}
          </Link>
        </RouteDrawer>
      ) : null}
    </>
  );
}
