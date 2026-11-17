import { getFormatter, getTranslations } from 'next-intl/server';
import Icon, { type IconName } from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { getVerificationSummary } from '@/server/services/verification';
import { listSellerRequests, searchListings } from '@/server/services/directory';
import { sellerLeadMetrics } from '@/server/services/enquiries';
import { listGovProgrammes } from '@/server/services/gov';
import { listNews } from '@/server/services/news';
import { getOptionalUser } from '@/server/session';
import { getWorkspace } from '@/server/workspace';

function Section({ id, icon, title, more, children }: { id: string; icon: IconName; title: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 id={id} style={{ margin: 0, fontSize: '1.0625rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name={icon} size={20} />
          {title}
        </h2>
        {more ? <Link href={more.href}>{more.label}</Link> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The signed-in Home: everything on it is read from records the person is allowed to see (published news and assistance, the public
 * directory, their own organisation's counts). Nothing is invented; a section with no records says so.
 */
export default async function AppHome({ locale }: { locale: string }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const { supabase } = await getOptionalUser();
  const ws = await getWorkspace();
  if (!supabase || !ws) return null;
  const hasOrg = ws.orgs.length > 0;
  const biz = ws.kind === 'business' && ws.org ? ws.org : null;

  const [news, gov, dir, claims, metrics, requests, buying] = await Promise.all([
    listNews(supabase, { page: 1 }),
    listGovProgrammes(supabase, { limit: 4 }),
    searchListings(supabase, { limit: 4 }),
    biz ? getVerificationSummary(supabase, biz.id) : Promise.resolve([]),
    biz ? sellerLeadMetrics(supabase, biz.id) : Promise.resolve(null),
    biz ? listSellerRequests(supabase, biz.id, 'all').catch(() => []) : Promise.resolve([]),
    ws.org ? supabase.from('buyer_requests').select('id', { count: 'exact', head: true }).eq('buyer_org_id', ws.org.id).in('status', ['open']) : Promise.resolve({ count: 0 }),
  ]);
  const newsItems = news.ok ? news.data.items.slice(0, 4) : [];
  const programmes = gov.ok ? gov.data.slice(0, 4) : [];
  const listings = dir.ok ? dir.data.items.slice(0, 4) : [];
  const approved = claims.filter((c) => c.status === 'approved').length;
  const m = metrics && 'ok' in metrics && metrics.ok ? metrics.data : null;
  const openEnquiries = m ? Math.max(0, m.enquiries_received - m.enquiries_answered) : 0;
  const newRequests = requests.filter((r) => r.match_status === 'invited' && r.request_status === 'open');

  type Action = { key: string; text: string; href: string };
  const actions: Action[] = [];
  if (!hasOrg) actions.push({ key: 'org', text: t('apphome.actOrg'), href: '/orgs' });
  if (biz && approved === 0) actions.push({ key: 'verify', text: t('apphome.actVerify'), href: `/orgs/${biz.id}/business/verification` });
  if (biz && newRequests.length > 0) actions.push({ key: 'req', text: t('apphome.actRequests', { n: newRequests.length }), href: `/orgs/${biz.id}/business/requests` });
  if (openEnquiries > 0) actions.push({ key: 'enq', text: t('apphome.actEnquiries', { n: openEnquiries }), href: '/enquiries' });
  if (ws.unread > 0) actions.push({ key: 'unread', text: t('apphome.actUnread', { n: ws.unread }), href: '/notifications' });
  if (biz) actions.push({ key: '360', text: t('apphome.act360'), href: `/orgs/${biz.id}/business/360` });
  else if (hasOrg) actions.push({ key: 'sell', text: t('apphome.actSell'), href: '/list-your-business' });
  actions.push({ key: 'assist', text: t('apphome.actAssist'), href: '/business-help/find' });

  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' });
  const money = (min: string | null, max: string | null) => (min || max ? [min, max].filter(Boolean).map((v) => `RM ${fmt.number(Number(v))}`).join(' – ') : t('apphome.amountNone'));

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('home.titleSignedIn', { name: ws.user.name })}</h1>
          <p className="muted">
            {ws.org ? `${ws.org.name} · ${t(`orgTypes.${ws.org.type}`)}` : t('apphome.noWorkspace')}
            {biz ? ` · ${approved > 0 ? t('apphome.reviewed') : t('apphome.notReviewed')}` : ''}
          </p>
        </div>
      </div>

      <form role="search" action={`/${locale}/directory`} method="get" className="home-search">
        <label htmlFor="home-q" className="sr">
          {t('apphome.searchLabel')}
        </label>
        <Icon name="search" size={20} />
        <input id="home-q" name="q" type="search" maxLength={80} placeholder={t('apphome.searchPlaceholder')} />
        <button type="submit" className="btn btn-primary btn-sm">
          {t('apphome.searchButton')}
        </button>
      </form>

      {!hasOrg ? (
        <section className="card" role="region" aria-labelledby="home-start" style={{ padding: 20 }}>
          <h2 id="home-start" style={{ marginTop: 0 }}>{t('apphome.startTitle')}</h2>
          <p>{t('apphome.startBody')}</p>
          <p className="link-row">
            <Link href="/orgs" className="btn btn-primary">{t('apphome.startCta')}</Link>
            <Link href="/directory" className="btn btn-secondary">{t('apphome.startSkip')}</Link>
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>{t('apphome.startNote')}</p>
        </section>
      ) : null}

      <Section id="home-orgs" icon="grid" title={t('home.yourOrgs')}>
        {ws.orgs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{t('home.noOrgs')}</p>
        ) : (
          <ul className="card-list" style={{ margin: 0 }}>
            {ws.orgs.map((o) => (
              <li key={o.id}>
                <Link href={o.home}>{o.name}</Link> <span className="muted">· {t(`orgTypes.${o.type}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="home-actions" icon="check" title={t('apphome.actionsTitle')}>
        <ul className="card-list" style={{ margin: 0 }}>
          {actions.slice(0, 6).map((a) => (
            <li key={a.key} className="card" style={{ boxShadow: 'none' }}>
              <Link href={a.href}>{a.text}</Link>
            </li>
          ))}
        </ul>
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', gap: 18 }}>
        <Section id="home-news" icon="news" title={t('apphome.newsTitle')} more={{ href: '/news', label: t('apphome.seeAll') }}>
          {newsItems.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t('apphome.newsNone')}</p>
          ) : (
            <ul className="card-list" style={{ margin: 0 }}>
              {newsItems.map((n) => (
                <li key={n.id}>
                  <Link href={`/news/${n.id}`}>{n.title}</Link>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.875rem' }}>
                    {[n.publisher, date(n.published_at)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="home-gov" icon="money" title={t('apphome.govTitle')} more={{ href: '/business-help', label: t('apphome.seeAll') }}>
          {programmes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t('apphome.govNone')}</p>
          ) : (
            <ul className="card-list" style={{ margin: 0 }}>
              {programmes.map((p) => (
                <li key={p.id}>
                  <Link href={`/business-help/${p.slug}`}>{p.name}</Link>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.875rem' }}>
                    {p.agency_name} · {p.funding_type ? t(`gov.type.${p.funding_type}`) : '-'} · {t(`gov.status.${p.application_status}`)} · {money(p.amount_min, p.amount_max)}
                    {p.closes_on ? ` · ${date(`${p.closes_on}T00:00:00Z`)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="home-market" icon="store" title={t('apphome.marketTitle')} more={{ href: '/directory', label: t('apphome.seeAll') }}>
          {listings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t('apphome.marketNone')}</p>
          ) : (
            <ul className="card-list" style={{ margin: 0 }}>
              {listings.map((l) => (
                <li key={l.slug}>
                  <Link href={`/directory/${l.slug}`}>{l.name}</Link>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.875rem' }}>{[l.district, l.state].filter(Boolean).join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
          {newRequests.length > 0 && biz ? (
            <p style={{ margin: 0 }}>
              <Link href={`/orgs/${biz.id}/business/requests`}>{t('apphome.buyerRequests', { n: newRequests.length })}</Link>
            </p>
          ) : null}
        </Section>

        <Section id="home-activity" icon="message" title={t('apphome.activityTitle')}>
          <ul className="card-list" style={{ margin: 0 }}>
            <li><Link href="/notifications">{t('apphome.unread', { n: ws.unread })}</Link></li>
            <li><Link href="/requests">{t('apphome.openRequests', { n: buying.count ?? 0 })}</Link></li>
            {biz ? <li><Link href="/enquiries">{t('apphome.openEnquiries', { n: openEnquiries })}</Link></li> : null}
            {biz && m ? <li><Link href="/enquiries">{t('apphome.quotesSent', { n: m.quotes_sent })}</Link></li> : null}
          </ul>
        </Section>
      </div>
    </div>
  );
}
