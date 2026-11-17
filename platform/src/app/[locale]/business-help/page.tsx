import { getFormatter, getTranslations } from 'next-intl/server';
import ProgrammeCard from '@/components/gov/ProgrammeCard';
import Icon, { type IconName } from '@/components/ui/Icon';
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
const LISTED = new Set(['open', 'upcoming', 'dates_not_confirmed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Programmes & Opportunities. Everything shown is a published programme; the four counts are real filters over the same list, and a
 * recommendation appears only for a business that answered the questions (the matcher explains each one). Saving is a personal bookmark.
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
  const shown = { all: entries, recommended, new: fresh, closing, saved }[tab];

  const cards: { key: Tab; label: string; hint: string; n: number; icon: IconName }[] = [
    { key: 'recommended', label: t('opps.cardRec'), hint: answered ? t('opps.hintRec') : t('opps.needProfile'), n: recommended.length, icon: 'star' },
    { key: 'new', label: t('opps.cardNew'), hint: t('opps.hintNew'), n: fresh.length, icon: 'plus' },
    { key: 'closing', label: t('opps.cardClosing'), hint: t('opps.hintClosing'), n: closing.length, icon: 'clock' },
    { key: 'saved', label: t('opps.cardSaved'), hint: t('opps.hintSaved'), n: saved.length, icon: 'bookmark' },
  ];
  const tabLabel: Record<Tab, string> = { all: t('opps.tabAll'), recommended: t('opps.tabRec'), new: t('opps.tabNew'), closing: t('opps.tabClosing'), saved: t('opps.tabSaved') };
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' });

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link href="/">{t('opps.crumbHome')}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{t('opps.title')}</span>
      </nav>
      <h1 style={{ margin: '4px 0 4px' }}>{t('opps.title')}</h1>
      <p className="muted" style={{ margin: '0 0 16px' }}>{t('opps.sub')}</p>

      <ul className="opps-cards" aria-label={t('opps.filters')}>
        {cards.map((c) => (
          <li key={c.key}>
            <Link href={`/business-help?tab=${c.key}`} className="opps-card" aria-current={tab === c.key ? 'true' : undefined}>
              <span className="opps-card-ico" aria-hidden="true">
                <Icon name={c.icon} size={20} />
              </span>
              <span className="opps-card-n">{c.n}</span>
              <span className="opps-card-l">{c.label}</span>
              <span className="opps-card-h">{c.hint}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="opps-grid">
        <div style={{ minWidth: 0 }}>
          <nav aria-label={t('opps.filters')} className="opps-tabs">
            {TABS.map((k) => (
              <Link key={k} href={k === 'all' ? '/business-help' : `/business-help?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>
                {tabLabel[k]}
              </Link>
            ))}
          </nav>
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
            <p>{t('opps.emptyTab')}</p>
          ) : (
            <ul className="card-list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))' }}>
              {shown.map(({ p, match }) => (
                <ProgrammeCard key={p.id} p={p} locale={locale} match={match} orgId={org?.org.id ?? null} signedIn={Boolean(user)} saved={savedIds.has(p.id)} />
              ))}
            </ul>
          )}
          {!user ? <p className="muted">{t('opps.signInSave')}</p> : null}
        </div>

        <aside className="opps-aside" aria-label={t('opps.howTitle')}>
          <section className="card" aria-labelledby="opps-how">
            <h2 id="opps-how" style={{ marginTop: 0, fontSize: '1.0625rem' }}>{t('opps.howTitle')}</h2>
            <ol className="opps-how">
              {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
                <li key={k}>{t(`opps.${k}`)}</li>
              ))}
            </ol>
          </section>
          <section className="card" aria-labelledby="opps-news">
            <h2 id="opps-news" style={{ marginTop: 0, fontSize: '1.0625rem' }}>{t('opps.newsTitle')}</h2>
            {news.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t('opps.newsNone')}</p>
            ) : (
              <ul className="card-list" style={{ margin: 0 }}>
                {news.map((n) => (
                  <li key={n.id}>
                    <Link href={`/news/${n.id}`}>{n.title}</Link>
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.8125rem' }}>{[n.publisher, date(n.published_at)].filter(Boolean).join(' · ')}</p>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginBottom: 0 }}>
              <Link href="/news">{t('opps.newsAll')}</Link>
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
