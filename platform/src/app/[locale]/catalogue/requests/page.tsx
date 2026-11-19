import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { pageTitle } from '@/lib/metadata';
import { formatDate } from '@/lib/p5-format';
import { getSourcingRequest, listMySourcingRequests } from '@/server/services/p5-buyer';
import type { SourcingRequestRow } from '@/server/services/p5-types';
import { requireSession } from '@/server/session';
import EmptyState from '@/components/shared/EmptyState';
import DealsTabs from '@/components/deals/DealsTabs';
import PageHeader from '@/components/shared/PageHeader';

const PAGE = 25;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5buyer.requests.title');
}

const tone = (s: string) => (s === 'acknowledged' ? 'approved' : s === 'withdrawn' || s === 'closed' ? 'rejected' : s === 'clarification_requested' ? 'needs_info' : 'none');

/** My product price requests (DB-backed: they are all here after signing out and in again). */
export default async function MyProductRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const rawPage = Number((await searchParams).page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 400 ? rawPage : 1;
  const session = await requireSession({ locale, requireOrg: true, path: '/catalogue/requests' });
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const orgs = eligibleBuyerOrgs(session.memberships);
  const lists = await Promise.all(orgs.map(async (m) => ({ org: m.org, res: await listMySourcingRequests(session.supabase, m.org.id, (page - 1) * PAGE) })));
  const failed = lists.some((l) => !l.res.ok);
  const rows: (SourcingRequestRow & { orgName: string })[] = lists
    .flatMap((l) => (l.res.ok ? l.res.data.items.map((i) => ({ ...i, orgName: l.org.name })) : []))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const hasNext = lists.some((l) => l.res.ok && l.res.data.total > page * PAGE);
  // The list rows carry no product names: read each request of this page (at most 25) for its first product.
  const names = new Map<string, { first: string | null; more: number }>();
  await Promise.all(
    rows.map(async (r) => {
      const d = await getSourcingRequest(session.supabase, r.id);
      if (d.ok) names.set(r.id, { first: d.data.items[0]?.snapshot.name ?? null, more: Math.max(0, d.data.items.length - 1) });
    }),
  );

  return (
    <>
      <PageHeader
        title={t('requests.title')}
        sub={t('requests.intro')}
        actions={
          <>
          <Link href="/catalogue" locale={locale} className="btn btn-primary">
            {tc('buttons.findProducts')}
          </Link>
          <Link href="/catalogue/saved" locale={locale} className="btn btn-secondary">
            {t('nav.saved')}
          </Link>
          </>
        }
      />
      <DealsTabs locale={locale} active="wholesale" />
      {failed ? (
        <p className="message message-error" role="alert">
          {t('requests.error')}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState icon="list" title={t('requests.emptyTitle')} text={t('requests.emptyBody')} />
      ) : (
        <ul className="card-list" aria-label={t('requests.title')}>
          {rows.map((r) => {
            const n = names.get(r.id);
            return (
              <li key={r.id} className="card" data-request-id={r.id}>
                <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>
                  <Link href={`/catalogue/requests/${r.id}`} locale={locale}>
                    {r.reference}
                  </Link>
                </h2>
                <p style={{ margin: '0 0 6px' }}>
                  <StatusChip status={tone(r.status)} label={tc(`status.sourcing.${r.status}`)} />
                </p>
                {n?.first ? (
                  <p style={{ margin: 0 }}>
                    {n.first}
                    {n.more > 0 ? ` ${t('requests.andMore', { n: n.more })}` : ''}
                  </p>
                ) : null}
                <p className="muted" style={{ margin: 0 }}>
                  {[r.supplier_name, r.destination_state, t('requests.sentOn', { date: formatDate(r.created_at, locale) })].filter(Boolean).join(' · ')}
                </p>
                {orgs.length > 1 ? <p className="muted">{r.orgName}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {page > 1 || hasNext ? (
        <nav aria-label={t('search.pages')} className="link-row catalogue-pages">
          {page > 1 ? (
            <Link href={`/catalogue/requests?page=${page - 1}`} locale={locale} className="btn btn-secondary">
              {t('search.prev')}
            </Link>
          ) : null}
          <span>{t('requests.page', { page })}</span>
          {hasNext ? (
            <Link href={`/catalogue/requests?page=${page + 1}`} locale={locale} className="btn btn-secondary">
              {t('search.next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
