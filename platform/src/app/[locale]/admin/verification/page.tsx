import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { claimStatusFilterSchema } from '@/lib/schemas';
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
  const { session, canReview } = await requireReviewer(locale, '/admin/verification');
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
  const [items, counts] = await Promise.all([listQueue(session.supabase, filter), queueCounts(session.supabase)]);

  return (
    <>
      <h1>{t('adminVer.title')}</h1>
      <p>{t('adminVer.intro')}</p>

      <h2>{t('adminVer.countsTitle')}</h2>
      <ul className="card-list">
        {STATUSES.map((s) => (
          <li key={s} className="card">
            <Link href={`/admin/verification?status=${s}`} locale={locale}>
              {t(`claimStatus.${s}`)}
            </Link>
            : <strong>{counts[s] ?? 0}</strong>
          </li>
        ))}
      </ul>

      <form method="get" className="inline-form">
        <div className="field">
          <label htmlFor="status">{t('adminVer.filterLabel')}</label>
          <select id="status" name="status" defaultValue={filter}>
            <option value="open">{t('adminVer.filterOpen')}</option>
            <option value="all">{t('adminVer.filterAll')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`claimStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          {t('adminVer.filterApply')}
        </button>
      </form>

      {items.length === 0 ? (
        <p>{t('adminVer.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th scope="col">{t('adminVer.business')}</th>
                <th scope="col">{t('adminVer.claim')}</th>
                <th scope="col">{t('adminVer.status')}</th>
                <th scope="col">{t('adminVer.age')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('adminVer.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td data-label={t('adminVer.business')}>{c.org_name}</td>
                  <td data-label={t('adminVer.claim')}>{t(`claimTypes.${c.claim_type}`)}</td>
                  <td data-label={t('adminVer.status')}>
                    <StatusChip status={c.status} label={t(`claimStatus.${c.status}`)} />
                  </td>
                  <td data-label={t('adminVer.age')}>{c.age_days === null ? '-' : t('adminVer.ageDays', { days: c.age_days })}</td>
                  <td>
                    <Link href={`/admin/verification/${c.id}`} locale={locale}>
                      {t('adminVer.open')}
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
