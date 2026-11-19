import { getFormatter, getTranslations } from 'next-intl/server';
import DiscoveryCard from '@/components/cards/DiscoveryCard';
import MetricCard from '@/components/cards/MetricCard';
import NewsCard from '@/components/cards/NewsCard';
import OpportunityCard from '@/components/cards/OpportunityCard';
import EmptyState from '@/components/shared/EmptyState';
import SectionHeader from '@/components/shared/SectionHeader';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { displayStatus } from '@/lib/gov-status';
import { formatRm } from '@/lib/gov-ui';
import { initialsOf } from '@/components/ui/Tag';
import { getOwnerListing, listSellerRequests, searchListings } from '@/server/services/directory';
import { sellerLeadMetrics } from '@/server/services/enquiries';
import { listGovProgrammes } from '@/server/services/gov';
import { listNews } from '@/server/services/news';
import { getVerificationSummary, queueCounts } from '@/server/services/verification';
import { getOptionalUser } from '@/server/session';
import { getWorkspace } from '@/server/workspace';

/**
 * The signed-in Home. Every card is built from records the person may see: published programmes and news, the public directory and the
 * counts of their own organisation. A section with nothing to show says so and offers one useful action; nothing is invented.
 */
export default async function AppHome({ locale }: { locale: string }) {
  const t = await getTranslations({ locale });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const fmt = await getFormatter({ locale });
  const { supabase } = await getOptionalUser();
  const ws = await getWorkspace();
  if (!supabase || !ws) return null;
  const hasOrg = ws.orgs.length > 0;
  const biz = ws.kind === 'business' && ws.org ? ws.org : null;

  const [news, gov, dir, claims, metrics, requests, buying, queue] = await Promise.all([
    listNews(supabase, { page: 1 }),
    listGovProgrammes(supabase, { limit: 12 }),
    searchListings(supabase, { limit: 3 }),
    biz ? getVerificationSummary(supabase, biz.id) : Promise.resolve([]),
    biz ? sellerLeadMetrics(supabase, biz.id) : Promise.resolve(null),
    biz ? listSellerRequests(supabase, biz.id, 'all').catch(() => []) : Promise.resolve([]),
    ws.org ? supabase.from('buyer_requests').select('id', { count: 'exact', head: true }).eq('buyer_org_id', ws.org.id).in('status', ['open']) : Promise.resolve({ count: 0 }),
    ws.isStaff ? queueCounts(supabase).catch(() => ({}) as Record<string, number>) : Promise.resolve({} as Record<string, number>),
  ]);
  const newsItems = news.ok ? news.data.items.slice(0, 3) : [];
  const programmes = (gov.ok ? gov.data : []).slice(0, 3);
  const listings = dir.ok ? dir.data.items.slice(0, 3) : [];
  const approved = claims.filter((c) => c.status === 'approved').length;
  const m = metrics && 'ok' in metrics && metrics.ok ? metrics.data : null;
  const openEnquiries = m ? Math.max(0, m.enquiries_received - m.enquiries_answered) : 0;
  const newRequests = requests.filter((r) => r.match_status === 'invited' && r.request_status === 'open');
  const waiting = (queue.submitted ?? 0) + (queue.in_review ?? 0);

  type Action = { key: string; text: string; href: string };
  const actions: Action[] = [];
  // A business that has not yet written its page starts with the 3-step quick start; verification details follow as next steps.
  const ownListing = biz ? await getOwnerListing(supabase, biz.id) : null;
  if (biz && !ownListing?.draft?.headline) actions.push({ key: 'quick', text: d('quick.homeAction'), href: `/orgs/${biz.id}/business/quickstart` });
  if (!hasOrg) actions.push({ key: 'org', text: t('apphome.actOrg'), href: '/orgs' });
  if (biz && approved === 0) actions.push({ key: 'verify', text: t('apphome.actVerify'), href: `/orgs/${biz.id}/business/verification` });
  if (biz && newRequests.length > 0) actions.push({ key: 'req', text: t('apphome.actRequests', { n: newRequests.length }), href: `/orgs/${biz.id}/business/requests` });
  if (openEnquiries > 0) actions.push({ key: 'enq', text: t('apphome.actEnquiries', { n: openEnquiries }), href: '/enquiries' });
  if (ws.unread > 0) actions.push({ key: 'unread', text: t('apphome.actUnread', { n: ws.unread }), href: '/notifications' });
  if (biz) actions.push({ key: '360', text: t('apphome.act360'), href: `/orgs/${biz.id}/business/360` });
  else if (hasOrg) actions.push({ key: 'sell', text: t('apphome.actSell'), href: '/list-your-business' });
  actions.push({ key: 'assist', text: t('apphome.actAssist'), href: '/business-help' });

  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' });
  const money = (min: string | null, max: string | null) =>
    min || max ? [min, max].filter(Boolean).map((v) => `RM ${fmt.number(Number(v))}`).join(' – ') : t('apphome.amountNone');
  const catLabel = (c: string) => t(`news2.chip${c[0]!.toUpperCase()}${c.slice(1)}`);

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="pagehead">
        <div>
          <h1>{t('home.titleSignedIn', { name: ws.user.name })}</h1>
          <p>
            {ws.org ? `${ws.org.name} · ${t(`orgTypes.${ws.org.type}`)}` : t('apphome.noWorkspace')}
            {biz ? ` · ${approved > 0 ? t('apphome.reviewed') : t('apphome.notReviewed')}` : ''}
          </p>
        </div>
        {ws.isStaff ? (
          <Link href="/admin" className="btn btn-secondary btn-sm">
            <Icon name="shield" size={16} />
            {waiting > 0 ? t('apphome.adminWaiting', { n: waiting }) : t('apphome.adminOpen')}
          </Link>
        ) : null}
      </div>

      <form role="search" action={`/${locale}/directory`} method="get" className="home-search">
        <label htmlFor="home-q" className="sr">
          {t('apphome.searchLabel')}
        </label>
        <Icon name="search" size={20} />
        <input id="home-q" name="q" type="search" maxLength={80} placeholder={t('apphome.searchPlaceholder')} />
        <button type="submit" className="btn btn-primary btn-sm">
          {t('apphome.searchBusinesses')}
        </button>
        <button type="submit" formAction={`/${locale}/catalogue`} className="btn btn-secondary btn-sm">
          {t('apphome.searchProducts')}
        </button>
      </form>

      <section aria-label={t('apphome.discoverTitle')} className="xgrid xgrid-4">
        <DiscoveryCard href="/directory" icon="search" title={t('apphome.dBusinessT')} text={t('apphome.dBusinessD')} action={t('apphome.dBusinessA')} />
        <DiscoveryCard href="/business-help" icon="money" title={t('apphome.dGovT')} text={t('apphome.dGovD')} action={t('apphome.dGovA')} />
        <DiscoveryCard href="/catalogue" icon="box" title={t('apphome.dProductsT')} text={t('apphome.dProductsD')} action={t('apphome.dProductsA')} />
        <DiscoveryCard href="/news" icon="news" title={t('apphome.dNewsT')} text={t('apphome.dNewsD')} action={t('apphome.dNewsA')} />
      </section>

      <section aria-labelledby="home-orgs">
        <SectionHeader id="home-orgs" title={t('home.yourOrgs')} more={{ href: '/orgs', label: t('apphome.switchOrAdd') }} />
        {ws.orgs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('home.noOrgs')}
          </p>
        ) : (
          <div className="xgrid xgrid-3">
            {ws.orgs.map((o) => (
              <Link key={o.id} href={o.home} className="lcard" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="lcard-top">
                  <span className="lcard-mono" aria-hidden="true">
                    {initialsOf(o.name)}
                  </span>
                  <span>
                    <strong>{o.name}</strong>
                    <br />
                    <span className="muted" style={{ fontSize: '0.8125rem' }}>
                      {t(`orgTypes.${o.type}`)}
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {!hasOrg ? (
        <section className="acard" aria-labelledby="home-start">
          <h2 id="home-start" style={{ margin: 0 }}>
            {t('apphome.startTitle')}
          </h2>
          <p style={{ margin: 0 }}>{t('apphome.startBody')}</p>
          <p className="link-row" style={{ margin: 0 }}>
            <Link href="/orgs" className="btn btn-gold">
              {t('apphome.startCta')}
            </Link>
            <Link href="/directory" className="btn btn-secondary">
              {t('apphome.startSkip')}
            </Link>
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
            {t('apphome.startNote')}
          </p>
        </section>
      ) : null}

      <div className="xgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))', alignItems: 'start' }}>
        <section aria-labelledby="home-opps">
          <SectionHeader id="home-opps" title={t('apphome.govTitle')} more={{ href: '/business-help', label: t('apphome.seeAll') }} />
          {programmes.length === 0 ? (
            <EmptyState icon="money" title={t('apphome.govEmptyT')} text={t('apphome.govEmptyD')} action={{ href: '/business-help', label: t('apphome.govEmptyA') }} />
          ) : (
            <div className="xgrid">
              {programmes.map((p) => {
                const st = displayStatus({ publication_state: 'published', verification_status: p.verification_status, application_status: p.application_status, closes_on: p.closes_on, is_stale: p.is_stale });
                return (
                  <OpportunityCard
                    key={p.id}
                    slug={p.slug}
                    name={p.name}
                    agency={p.agency_name}
                    type={p.funding_type ? t(`gov.type.${p.funding_type}`) : t('apphome.typeOther')}
                    status={t(`gov.dstatus.${st}`)}
                    amount={p.amount_max ? (p.amount_min && p.amount_min !== p.amount_max ? `${formatRm(p.amount_min)} – ${formatRm(p.amount_max)}` : money(null, p.amount_max)) : t('apphome.amountNone')}
                    deadline={p.closes_on ? date(`${p.closes_on}T00:00:00Z`) : null}
                    detailsLabel={t('apphome.viewDetails')}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="home-actions" className="acard">
          <h2 id="home-actions" style={{ margin: 0 }}>
            {biz ? t('apphome.workspaceTitle') : t('apphome.actionsTitle')}
          </h2>
          {biz ? (
            <p className="muted" style={{ margin: 0 }}>
              {biz.name} · {approved > 0 ? t('apphome.reviewed') : t('apphome.notReviewed')}
            </p>
          ) : null}
          <ul className="card-list" style={{ margin: 0 }}>
            {actions.slice(0, 5).map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="dcard-go">
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
          {biz && (m || ws.unread > 0 || (buying.count ?? 0) > 0) ? (
            <div className="xgrid xgrid-4" style={{ gap: 12 }}>
              {openEnquiries > 0 ? <MetricCard value={openEnquiries} label={t('apphome.metricEnquiries')} /> : null}
              {m && m.quotes_sent > 0 ? <MetricCard value={m.quotes_sent} label={t('apphome.metricQuotes')} /> : null}
              {ws.unread > 0 ? <MetricCard value={ws.unread} label={t('apphome.metricUnread')} /> : null}
              {(buying.count ?? 0) > 0 ? <MetricCard value={buying.count ?? 0} label={t('apphome.metricRequests')} /> : null}
            </div>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="home-news">
        <SectionHeader id="home-news" title={t('apphome.newsTitle')} more={{ href: '/news', label: t('apphome.seeAll') }} />
        {newsItems.length === 0 ? (
          <EmptyState icon="news" title={t('apphome.newsEmptyT')} text={t('apphome.newsEmptyD')} action={{ href: '/news', label: t('apphome.newsEmptyA') }} />
        ) : (
          <div className="xgrid xgrid-3">
            {newsItems.map((n) => (
              <NewsCard key={n.id} id={n.id} title={n.title} summary={n.summary} category={catLabel(n.category)} publisher={n.publisher} date={date(n.published_at)} readLabel={t('apphome.readArticle')} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="home-market">
        <SectionHeader id="home-market" title={t('apphome.marketTitle')} more={{ href: '/directory', label: t('apphome.seeAll') }} />
        {listings.length === 0 ? (
          <EmptyState icon="store" title={t('apphome.marketEmptyT')} text={t('apphome.marketEmptyD')} action={{ href: '/directory', label: t('apphome.marketEmptyA') }} />
        ) : (
          <div className="xgrid xgrid-3">
            {listings.map((l) => (
              <article key={l.slug} className="lcard">
                <div className="lcard-top">
                  <span className="lcard-mono" aria-hidden="true">
                    {initialsOf(l.name)}
                  </span>
                  <div>
                    <h3>
                      <Link href={`/directory/${l.slug}`}>{l.name}</Link>
                    </h3>
                    <p>{[l.district, l.state].filter(Boolean).join(', ')}</p>
                  </div>
                </div>
                {l.headline ? <p>{l.headline}</p> : null}
                <Link href={`/directory/${l.slug}`} className="dcard-go">
                  {t('apphome.viewBusiness')}
                </Link>
              </article>
            ))}
          </div>
        )}
        {newRequests.length > 0 && biz ? (
          <p style={{ marginBottom: 0 }}>
            <Link href={`/orgs/${biz.id}/business/requests`}>{t('apphome.buyerRequests', { n: newRequests.length })}</Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
