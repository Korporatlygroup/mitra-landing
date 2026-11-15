import { getTranslations } from 'next-intl/server';
import ClaimReview from '@/components/admin/ClaimReview';
import RouteDrawer from '@/components/admin/RouteDrawer';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { claimStatusFilterSchema, uuidSchema } from '@/lib/schemas';
import { requireReviewer } from '@/server/reviewer';
import { listQueue, queueCounts } from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'adminVer.title');
}

const STATUSES = ['submitted', 'in_review', 'needs_info', 'approved', 'rejected', 'stale', 'withdrawn'] as const;

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
        <h1>{t('adminVer.title')}</h1>
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
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('adminVer.title')}</h1>
          <p className="page-sub">{t('adm2.queueSub')}</p>
        </div>
      </div>

      <nav aria-label={t('adminVer.filterLabel')} className="tiles">
        <Link href="/admin/verification?status=open" className="tile" aria-current={filter === 'open' ? 'true' : undefined}>
          <span className="mut" style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
            {t('adminVer.filterOpen')}
          </span>
          <span className="tile-n">{openCount}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/verification?status=${s}`} className="tile" aria-current={filter === s ? 'true' : undefined}>
            <span className="mut" style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
              {t(`claimStatus.${s}`)}
            </span>
            <span className="tile-n">{counts[s] ?? 0}</span>
          </Link>
        ))}
        <Link href="/admin/verification?status=all" className="tile" aria-current={filter === 'all' ? 'true' : undefined}>
          <span className="mut" style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
            {t('adminVer.filterAll')}
          </span>
        </Link>
      </nav>

      {items.length === 0 ? (
        <div className="empty">
          <strong>{t('adminVer.empty')}</strong>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th scope="col">{t('adminVer.business')}</th>
                <th scope="col">{t('adminVer.claim')}</th>
                <th scope="col">{t('adminVer.status')}</th>
                <th scope="col">{t('adm2.waiting')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('adminVer.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={claimParam.success && claimParam.data === c.id ? 'sel' : undefined}>
                  <td data-label={t('adminVer.business')}>
                    <strong>{c.org_name}</strong>
                  </td>
                  <td data-label={t('adminVer.claim')}>{t(`claimTypes.${c.claim_type}`)}</td>
                  <td data-label={t('adminVer.status')}>
                    <StatusChip status={c.status} label={t(`claimStatus.${c.status}`)} />
                  </td>
                  <td data-label={t('adm2.waiting')} style={c.age_days !== null && c.age_days >= 3 ? { color: 'var(--tag-coral)', fontWeight: 700 } : undefined}>
                    {c.age_days === null ? '-' : t('adminVer.ageDays', { days: c.age_days })}
                  </td>
                  <td>
                    <Link href={`/admin/verification?status=${filter}&claim=${c.id}`} className="btn btn-secondary btn-sm" aria-label={`${t('adm2.review')}: ${c.org_name}`}>
                      {t('adm2.review')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
