import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { pageTitle } from '@/lib/metadata';
import { listBuyerRequests, listEnquiries, type BuyerRequestSummary } from '@/server/services/directory';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'req.title');
}

export default async function MyRequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await requireSession({ locale, requireOrg: true, path: '/requests' });
  const t = await getTranslations({ locale });
  const orgs = eligibleBuyerOrgs(session.memberships);
  const lists = await Promise.all(orgs.map(async (m) => ({ org: m.org, items: await listBuyerRequests(session.supabase, m.org.id) })));
  const enquiries = orgs.length ? await listEnquiries(session.supabase, { buyerOrgIds: orgs.map((m) => m.org.id) }) : [];
  const all: (BuyerRequestSummary & { orgName: string })[] = lists
    .flatMap((l) => l.items.map((i) => ({ ...i, orgName: l.org.name })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <h1>{t('req.title')}</h1>
      <p className="link-row">
        <Link href="/requests/new" locale={locale} className="btn btn-primary">
          {t('req.post')}
        </Link>
        <Link href="/directory" locale={locale} className="btn btn-secondary">
          {t('dir.title')}
        </Link>
      </p>
      {all.length === 0 ? (
        <section>
          <h2>{t('req.emptyTitle')}</h2>
          <p>{t('req.emptyBody')}</p>
        </section>
      ) : (
        <ul className="card-list">
          {all.map((r) => (
            <li key={r.id} className="card">
              <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>
                <Link href={r.status === 'draft' ? `/requests/new?step=1&id=${r.id}` : `/requests/${r.id}`} locale={locale}>
                  {r.title ?? t('req.untitled')}
                </Link>
              </h2>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={r.status === 'open' ? 'approved' : r.status === 'removed' ? 'rejected' : 'none'} label={t(`req.status.${r.status}`)} />
              </p>
              {r.status !== 'draft' ? (
                <p className="muted" style={{ margin: 0 }}>
                  {t('req.counts', { invited: r.invited, interested: r.interested, declined: r.declined })}
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {t('req.draftNote')}
                </p>
              )}
              {orgs.length > 1 ? <p className="muted">{r.orgName}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="enq-h">
        <h2 id="enq-h">{t('req.enquiriesTitle')}</h2>
        {enquiries.length === 0 ? (
          <p>{t('req.noEnquiries')}</p>
        ) : (
          <ul className="card-list">
            {enquiries.map((e) => (
              <li key={e.id} className="card">
                <Link href={`/enquiries/${e.id}`} locale={locale}>
                  {e.topic}
                </Link>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {t(`enq.statuses.${e.status}`)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
