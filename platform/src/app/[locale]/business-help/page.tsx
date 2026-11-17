import { getFormatter, getTranslations } from 'next-intl/server';
import ProgrammeCard from '@/components/gov/ProgrammeCard';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import TabsNav from '@/components/shared/TabsNav';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { matchProgramme, type AssistanceProfile, type MatchResult } from '@/lib/gov-matching';
import { daysUntil, displayStatus } from '@/lib/gov-status';
import { eligibleAssistOrgs, isRecent } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, listGovProgrammes, listMyGovSaved, type GovProgrammeRow } from '@/server/services/gov';
import { listNews } from '@/server/services/news';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.opps.title');
}

const TABS = ['all', 'recommended', 'new', 'closing', 'saved'] as const;
type Tab = (typeof TABS)[number];
const TYPES = ['financing', 'grant', 'subsidy', 'training', 'other'] as const;
const LISTED = new Set(['open', 'upcoming', 'dates_not_confirmed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Programmes & Opportunities. Everything shown is a published programme. The page opens on the programmes themselves (search, type
 * and tabs); matching is a separate, optional step, and a recommendation appears only for a business that answered the questions
 * (the matcher explains each one). Saving is a personal bookmark.
 */
export default async function BusinessHelpHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : 'all';
  const type = (TYPES as readonly string[]).includes(String(sp.type)) ? String(sp.type) : '';
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const { supabase, user } = await getOptionalUser();

  const memberships = supabase && user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleAssistOrgs(memberships);
  const wanted = typeof sp.org === 'string' && UUID.test(sp.org) ? sp.org : null;
  const org = (wanted ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;

  const [listRes, profileRes, savedRes, newsRes] = await Promise.all([
    supabase ? listGovProgrammes(supabase, { limit: 100 }) : null,
    supabase && org ? getGovProfile(supabase, org.org.id) : null,
    supabase && user ? listMyGovSaved(supabase) : null,
    supabase ? listNews(supabase, { page: 1 }) : null,
  ]);
  const all: GovProgrammeRow[] = listRes?.ok ? listRes.data : [];
  const profile = profileRes?.ok ? profileRes.data : null;
  const answered = Boolean(profile && profile.version >= 1);
  const savedIds = new Set(savedRes?.ok ? savedRes.data.map((s) => s.programme_id) : []);
  const news = newsRes?.ok ? newsRes.data.items.slice(0, 3) : [];

  const stateOf = (p: GovProgrammeRow) => displayStatus({ publication_state: 'published', verification_status: p.verification_status, application_status: p.application_status, closes_on: p.closes_on, is_stale: p.is_stale });
  const entries = all.map((p) => {
    const programme = {
      verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type,
      closes_on: p.closes_on, beneficiary_type: p.beneficiary_type, info_url: p.info_url, data: { rules: p.rules },
    };
    const match: MatchResult | null = answered && profile ? matchProgramme(programme, profile as AssistanceProfile) : null;
    return { p, match };
  });
  const recommended = entries.filter(({ p, match }) => match && (match.label === 'potential_match' || match.label === 'more_information_needed') && LISTED.has(stateOf(p)));
  const fresh = entries.filter(({ p }) => isRecent(p.last_verified_at, 30) && stateOf(p) !== 'closed');
  const closing = entries
    .filter(({ p }) => stateOf(p) === 'open' && (daysUntil(p.closes_on) ?? 999) <= 30)
    .sort((a, b) => (daysUntil(a.p.closes_on) ?? 0) - (daysUntil(b.p.closes_on) ?? 0));
  const saved = entries.filter(({ p }) => savedIds.has(p.id));
  const byTab = { all: entries, recommended, new: fresh, closing, saved };
  const needle = q.toLowerCase();
  const shown = byTab[tab].filter(({ p }) => (!type || p.funding_type === type) && (!needle || `${p.name} ${p.agency_name}`.toLowerCase().includes(needle)));

  const tabLabel: Record<Tab, string> = { all: t('opps.tabAll'), recommended: t('opps.tabRec'), new: t('opps.tabNew'), closing: t('opps.tabClosing'), saved: t('opps.tabSaved') };
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' });
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (type) p.set('type', type);
    if (q) p.set('q', q);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const filtered = Boolean(type || q || tab !== 'all');
  const matchHref = org ? `/business-help/find?org=${org.org.id}` : user ? '/orgs' : '/business-help/find';

  return (
    <>
      <PageHeader
        eyebrow={
          <nav aria-label="Breadcrumb" className="crumbs" style={{ margin: 0 }}>
            <Link href="/">{t('opps.crumbHome')}</Link>
            <span aria-hidden="true"> / </span>
            <span aria-current="page">{t('opps.title')}</span>
          </nav>
        }
        title={t('opps.title')}
        sub={t('opps.sub')}
      />

      <form method="get" role="search" className="toolbar-x">
        {tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
        {org && sp.org ? <input type="hidden" name="org" value={org.org.id} /> : null}
        <div className="search-x">
          <Icon name="search" size={18} />
          <label className="sr" htmlFor="gh-q">
            {t('opps.search')}
          </label>
          <input id="gh-q" name="q" type="search" maxLength={80} defaultValue={q} placeholder={t('opps.search')} />
        </div>
        <label className="sr" htmlFor="gh-type">
          {t('opps.typeLabel')}
        </label>
        <select id="gh-type" name="type" defaultValue={type} className="select-x">
          <option value="">{t('opps.typeAll')}</option>
          {TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`type.${k}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">
          {t('opps.searchBtn')}
        </button>
        {filtered ? (
          <Link href="/business-help" className="btn btn-ghost btn-sm">
            {t('opps.clear')}
          </Link>
        ) : null}
      </form>

      <TabsNav
        label={t('opps.filters')}
        items={TABS.map((k) => ({
          href: `/business-help${keep(k === 'all' ? {} : { tab: k })}`,
          label: tabLabel[k],
          count: k === 'all' ? undefined : byTab[k].length,
          active: tab === k,
        }))}
      />

      <div className="opps-grid">
        <div style={{ minWidth: 0 }}>
          {tab === 'recommended' && !answered ? (
            <p className="banner" role="note">
              {user && org ? (
                <>
                  {t('opps.needProfile')} <Link href={`/business-help/find?org=${org.org.id}`}>{t('opps.answer')}</Link>
                </>
              ) : user ? (
                <>
                  {t('opps.trackNeedsBusiness')} <Link href="/orgs">{t('opps.answer')}</Link>
                </>
              ) : (
                <>
                  {t('opps.signInSave')} <Link href="/login?next=/business-help%3Ftab%3Drecommended">{t('opps.answer')}</Link>
                </>
              )}
            </p>
          ) : null}
          {shown.length === 0 ? (
            <EmptyState icon="money" title={filtered ? t('opps.noMatch') : t('opps.emptyTab')} text={filtered ? t('opps.noMatchBody') : t('opps.sub')} action={filtered ? { href: '/business-help', label: t('opps.clear') } : undefined} />
          ) : (
            <>
              <p className="mut" role="status" style={{ margin: '0 0 12px', fontSize: '0.875rem' }}>
                {t('opps.results', { n: shown.length })}
              </p>
              <ul className="xgrid xgrid-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {shown.map(({ p, match }) => (
                  <ProgrammeCard key={p.id} p={p} locale={locale} match={match} orgId={org?.org.id ?? null} signedIn={Boolean(user)} saved={savedIds.has(p.id)} />
                ))}
              </ul>
            </>
          )}
          {!user ? <p className="muted">{t('opps.signInSave')}</p> : null}
        </div>

        <aside className="opps-aside" aria-label={t('opps.howTitle')}>
          <section className="acard" aria-labelledby="opps-match">
            <span className="dcard-ico" aria-hidden="true">
              <Icon name="target" size={20} />
            </span>
            <h2 id="opps-match" style={{ margin: 0, fontSize: '1.0625rem' }}>
              {t('opps.matchTitle')}
            </h2>
            <p className="mut" style={{ margin: 0, fontSize: '0.875rem' }}>
              {t('opps.matchText')}
            </p>
            <div>
              <Link href={matchHref} className="btn btn-primary btn-sm">
                {t('opps.matchCta')}
              </Link>
            </div>
          </section>
          <section className="acard" aria-labelledby="opps-how">
            <h2 id="opps-how" style={{ margin: 0, fontSize: '1.0625rem' }}>
              {t('opps.howTitle')}
            </h2>
            <ol className="opps-how">
              {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
                <li key={k}>{t(`opps.${k}`)}</li>
              ))}
            </ol>
          </section>
          <section className="acard" aria-labelledby="opps-news">
            <h2 id="opps-news" style={{ margin: 0, fontSize: '1.0625rem' }}>
              {t('opps.newsTitle')}
            </h2>
            {news.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t('opps.newsNone')}
              </p>
            ) : (
              <ul className="stack-x" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {news.map((n) => (
                  <li key={n.id}>
                    <Link href={`/news/${n.id}`}>{n.title}</Link>
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.8125rem' }}>
                      {[n.publisher, date(n.published_at)].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Link href="/news">{t('opps.newsAll')}</Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
