import { getTranslations } from 'next-intl/server';
import Dashboard, { type DashboardData } from '@/components/gov/Dashboard';
import { Link } from '@/i18n/navigation';
import { matchProgramme, rankMatches, type AssistanceProfile } from '@/lib/gov-matching';
import { categoryOf, daysUntil, displayStatus } from '@/lib/gov-status';
import { eligibleAssistOrgs, isRecent } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, listGovProgrammes, listGovSaved } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.title');
}

const CHOICES = [
  { key: 'financing', href: '/business-help/find?need=financing', icon: '💰' },
  { key: 'grant', href: '/business-help/find?need=grant', icon: '🎁' },
  { key: 'training', href: '/business-help/find?need=training', icon: '📚' },
  { key: 'growth', href: '/business-help/find?need=growth', icon: '📈' },
  { key: 'saved', href: '/business-help/saved', icon: '⭐' },
] as const;

const SUPPORT = new Set(['training', 'advisory', 'entrepreneurship', 'digital']);
const LISTED = new Set(['open', 'upcoming', 'dates_not_confirmed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Business help home: the five large choices first (no assessment before browsing), then a plain dashboard. Public data works for
 * visitors; the personal sections need a signed-in business and say so when they are empty.
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
  const t = await getTranslations({ locale, namespace: 'gov' });
  const { supabase, user } = await getOptionalUser();

  const memberships = supabase && user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleAssistOrgs(memberships);
  const wanted = typeof sp.org === 'string' && UUID.test(sp.org) ? sp.org : null;
  const org = (wanted ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;

  const [listRes, profileRes, savedRes] = await Promise.all([
    supabase ? listGovProgrammes(supabase, { limit: 100 }) : null,
    supabase && org ? getGovProfile(supabase, org.org.id) : null,
    supabase && org ? listGovSaved(supabase, org.org.id) : null,
  ]);
  const all = listRes?.ok ? listRes.data : [];
  const profile: AssistanceProfile = profileRes?.ok ? profileRes.data : {};
  const saved = savedRes?.ok ? savedRes.data : [];
  const stateOf = (p: (typeof all)[number]) =>
    displayStatus({ publication_state: 'published', verification_status: p.verification_status, application_status: p.application_status, closes_on: p.closes_on, is_stale: p.is_stale });

  const recommended = rankMatches(
    all.map((p) => {
      const programme = {
        verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type,
        closes_on: p.closes_on, beneficiary_type: p.beneficiary_type, info_url: p.info_url, data: { rules: p.rules },
      };
      return { p, programme, match: matchProgramme(programme, profile) };
    }),
  )
    .filter(({ p, match }) => (match.label === 'potential_match' || match.label === 'more_information_needed') && LISTED.has(stateOf(p)))
    .slice(0, 6)
    .map(({ p, match }) => ({ p, label: match.label }));

  const data: DashboardData = {
    orgId: org?.org.id ?? null,
    signedIn: Boolean(user),
    recommended,
    fresh: all.filter((p) => isRecent(p.last_verified_at, 30) && stateOf(p) !== 'closed').slice(0, 6),
    closing: all
      .filter((p) => stateOf(p) === 'open' && (daysUntil(p.closes_on) ?? 999) <= 30)
      .sort((a, b) => (daysUntil(a.closes_on) ?? 0) - (daysUntil(b.closes_on) ?? 0))
      .slice(0, 6),
    saved: saved.filter((r) => r.tracking_status !== 'not_interested').slice(0, 6),
    applications: saved.filter((r) => !['interested', 'not_interested'].includes(r.tracking_status)).slice(0, 6),
    training: all.filter((p) => SUPPORT.has(categoryOf(p)) && stateOf(p) !== 'closed').slice(0, 6),
  };

  return (
    <>
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <ul className="gov-need-grid" aria-label={t('title')}>
        {CHOICES.map((c) => (
          <li key={c.key}>
            <Link href={c.href} locale={locale} className="gov-need-button">
              <span aria-hidden="true" className="gov-need-icon">
                {c.icon}
              </span>
              <span>{t(`home.${c.key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p>
        <Link href="/business-help/find" locale={locale}>
          {t('home.all')}
        </Link>
      </p>
      <Dashboard locale={locale} data={data} />
      <section aria-labelledby="gov-how-h">
        <h2 id="gov-how-h">{t('home.howTitle')}</h2>
        <ol>
          {(['how1', 'how2', 'how3', 'how4'] as const).map((k) => (
            <li key={k}>{t(`home.${k}`)}</li>
          ))}
        </ol>
      </section>
    </>
  );
}
