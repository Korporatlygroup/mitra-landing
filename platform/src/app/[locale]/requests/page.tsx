import { getFormatter, getTranslations } from 'next-intl/server';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/shared/StatusBadge';
import TabsNav from '@/components/shared/TabsNav';
import MetricCard from '@/components/cards/MetricCard';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { pageTitle } from '@/lib/metadata';
import { listBuyerRequests, listEnquiries, type BuyerRequestSummary } from '@/server/services/directory';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'req.title');
}

type Tab = 'all' | 'open' | 'draft' | 'closed';
const TABS: Tab[] = ['all', 'open', 'draft', 'closed'];
const TAB_LABEL: Record<Tab, string> = { all: 'req.tAll', open: 'req.tOpen', draft: 'req.tDraft', closed: 'req.tClosed' };
const tabOf = (s: BuyerRequestSummary['status']): Tab => (s === 'open' ? 'open' : s === 'draft' ? 'draft' : 'closed');
const TONE: Record<string, BadgeTone> = { open: 'green', draft: 'gold', closed: 'neutral', expired: 'neutral', withdrawn: 'neutral', removed: 'red' };

export default async function MyRequestsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await requireSession({ locale, requireOrg: true, path: '/requests' });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const orgs = eligibleBuyerOrgs(session.memberships);
  const lists = await Promise.all(orgs.map(async (m) => ({ org: m.org, items: await listBuyerRequests(session.supabase, m.org.id) })));
  const enquiries = orgs.length ? await listEnquiries(session.supabase, { buyerOrgIds: orgs.map((m) => m.org.id) }) : [];
  const all: (BuyerRequestSummary & { orgName: string })[] = lists
    .flatMap((l) => l.items.map((i) => ({ ...i, orgName: l.org.name })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'all';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const counts: Record<Tab, number> = { all: all.length, open: 0, draft: 0, closed: 0 };
  for (const r of all) counts[tabOf(r.status)] += 1;
  const shown = all.filter((r) => (tab === 'all' || tabOf(r.status) === tab) && (!q || (r.title ?? '').toLowerCase().includes(q.toLowerCase())));
  const interested = all.reduce((n, r) => n + (r.status === 'open' ? r.interested : 0), 0);
  const href = (nt: Tab) => `/requests${nt === 'all' ? '' : `?tab=${nt}`}`;
  const filtered = tab !== 'all' || q !== '';

  return (
    <>
      <PageHeader
        title={t('req.title')}
        sub={t('req.sub')}
        actions={
          <>
            <Link href="/directory" className="btn btn-secondary">
              {t('req.explore')}
            </Link>
            <Link href="/requests/new" className="btn btn-primary">
              <Icon name="plus" size={18} stroke={2.2} />
              {t('req.post')}
            </Link>
          </>
        }
      />

      {all.length === 0 && enquiries.length === 0 ? (
        <EmptyState icon="board" title={t('req.emptyCta')} text={t('req.emptyHint')} action={{ href: '/requests/new', label: t('req.post') }} />
      ) : (
        <>
          <section aria-label={t('req.title')} className="xgrid-m" style={{ marginBottom: 20 }}>
            <MetricCard value={counts.open} label={t('req.mOpen')} />
            <MetricCard value={counts.draft} label={t('req.mDraft')} />
            <MetricCard value={interested} label={t('req.mInterested')} />
            <MetricCard value={enquiries.length} label={t('req.mEnquiries')} />
          </section>

          <div className="split-x">
            <section aria-labelledby="req-list-h">
              <h2 id="req-list-h" className="sr">
                {t('req.title')}
              </h2>
              <TabsNav label={t('req.tabsLabel')} items={TABS.map((x) => ({ href: href(x), label: t(TAB_LABEL[x]), count: counts[x], active: tab === x }))} />
              <form method="get" role="search" className="toolbar-x">
                {tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
                <div className="search-x">
                  <Icon name="search" size={18} />
                  <label className="sr" htmlFor="req-q">
                    {t('req.search')}
                  </label>
                  <input id="req-q" name="q" type="search" maxLength={80} defaultValue={q} placeholder={t('req.search')} />
                </div>
                <button type="submit" className="btn btn-secondary btn-sm">
                  {t('req.searchBtn')}
                </button>
                {filtered ? (
                  <Link href="/requests" className="btn btn-ghost btn-sm">
                    {t('req.clear')}
                  </Link>
                ) : null}
              </form>

              {shown.length === 0 ? (
                <EmptyState icon="search" title={t('req.noMatch')} text={t('req.noMatchBody')} action={{ href: '/requests', label: t('req.clear') }} />
              ) : (
                <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {shown.map((r) => {
                    const to = r.status === 'draft' ? `/requests/new?step=1&id=${r.id}` : `/requests/${r.id}`;
                    return (
                      <li key={r.id} className="rrow">
                        <div className="rrow-top">
                          <h3>
                            <Link href={to}>{r.title ?? t('req.untitled')}</Link>
                          </h3>
                          <StatusBadge label={t(`req.status.${r.status}`)} tone={TONE[r.status] ?? 'neutral'} />
                        </div>
                        <div className="meta">
                          <span>{t('req.created', { date: fmt.dateTime(new Date(r.created_at), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) })}</span>
                          {r.target_state ? <span>{r.target_state}</span> : null}
                          {orgs.length > 1 ? <span>{r.orgName}</span> : null}
                        </div>
                        {r.status === 'draft' ? (
                          <p className="mut" style={{ margin: 0, fontSize: '0.875rem' }}>
                            {t('req.draftNote')}
                          </p>
                        ) : (
                          <div className="rrow-foot">
                            <span className="chip-x">{t('req.counts', { invited: r.invited, interested: r.interested, declined: r.declined })}</span>
                          </div>
                        )}
                        <div className="rrow-foot">
                          <Link href={to} className="btn btn-secondary btn-sm">
                            {r.status === 'draft' ? t('req.continue') : t('req.open')}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <aside aria-labelledby="enq-h">
              <div className="sechead">
                <h2 id="enq-h">{t('req.enquiriesTitle')}</h2>
              </div>
              {enquiries.length === 0 ? (
                <EmptyState icon="message" title={t('req.noEnquiries')} text={t('req.enqSub')} action={{ href: '/directory', label: t('req.explore') }} />
              ) : (
                <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {enquiries.map((e) => (
                    <li key={e.id} className="rrow">
                      <h3>
                        <Link href={`/enquiries/${e.id}`}>{e.topic}</Link>
                      </h3>
                      <div className="rrow-foot">
                        <StatusBadge label={t(`enq.statuses.${e.status}`)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
