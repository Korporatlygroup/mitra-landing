import { getTranslations } from 'next-intl/server';
import ProfileForm from '@/components/gov/ProfileForm';
import ProgrammeCard from '@/components/gov/ProgrammeCard';
import { Link } from '@/i18n/navigation';
import { matchProgramme, rankMatches, type AssistanceProfile } from '@/lib/gov-matching';
import { eligibleAssistOrgs, GOV_NEEDS, NEED_TO_FUNDING, parseNeed } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, listGovProgrammes, listGovSaved } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.find.title');
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guided finder. Step 1 need, step 2 a little about the business (signed-in business members only; stored privately),
 * step 3 the programmes, compared against what each agency published. Anonymous visitors can browse without answering anything.
 */
export default async function FindPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const need = parseNeed(one('need'));
  const t = await getTranslations({ locale, namespace: 'gov' });
  const { supabase, user } = await getOptionalUser();

  const memberships = supabase && user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleAssistOrgs(memberships);
  const wanted = one('org');
  const org = (wanted && uuid.test(wanted) ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;

  const profileRes = supabase && org ? await getGovProfile(supabase, org.org.id) : null;
  const profile = profileRes?.ok ? profileRes.data : null;
  const savedRes = supabase && org ? await listGovSaved(supabase, org.org.id) : null;
  const savedIds = new Set(savedRes?.ok ? savedRes.data.map((s) => s.programme_id) : []);

  const listRes = supabase ? await listGovProgrammes(supabase, { limit: 100 }) : null;
  const all = listRes?.ok ? listRes.data : [];
  const types = need ? NEED_TO_FUNDING[need] : null;
  const rows = types ? all.filter((p) => p.funding_type && types.includes(p.funding_type)) : all;
  const prof: AssistanceProfile = profile ?? {};
  const ranked = rankMatches(
    rows.map((p) => ({
      p,
      programme: { verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, closes_on: p.closes_on, data: { rules: p.rules } },
      match: matchProgramme({ verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, data: { rules: p.rules } }, { ...prof, needs: need ? [need] : prof.needs }),
    })),
  );

  return (
    <>
      <h1>{t('find.title')}</h1>
      {one('saved') ? (
        <p role="status" className="message message-ok">
          {t('find.saved')}
        </p>
      ) : null}
      <nav aria-label={t('find.step1')} className="link-row">
        <Link href="/business-help/find" locale={locale} className={need ? 'btn btn-secondary' : 'btn btn-primary'} aria-current={need ? undefined : 'page'}>
          {t('find.anyNeed')}
        </Link>
        {GOV_NEEDS.map((n) => (
          <Link key={n} href={`/business-help/find?need=${n}${org ? `&org=${org.org.id}` : ''}`} locale={locale} className={need === n ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={need === n ? 'page' : undefined}>
            {t(`need.${n}`)}
          </Link>
        ))}
      </nav>

      {!user ? (
        <p>
          <Link href={`/login?next=${encodeURIComponent(`/${locale}/business-help/find${need ? `?need=${need}` : ''}`)}`} locale={locale}>
            {t('find.signIn')}
          </Link>
        </p>
      ) : !org ? (
        <p>
          <Link href="/orgs" locale={locale}>
            {t('find.noOrg')}
          </Link>
        </p>
      ) : (
        <details open={!profile || profile.version === 0}>
          <summary>{t('find.step2')}</summary>
          {orgs.length > 1 ? (
            <p className="link-row">
              {orgs.map((m) => (
                <Link key={m.org.id} href={`/business-help/find?org=${m.org.id}${need ? `&need=${need}` : ''}`} locale={locale} aria-current={m.org.id === org.org.id ? 'page' : undefined}>
                  {m.org.name}
                </Link>
              ))}
            </p>
          ) : null}
          <ProfileForm locale={locale} orgId={org.org.id} profile={profile} need={need} />
        </details>
      )}

      <section aria-labelledby="gov-results-h">
        <h2 id="gov-results-h">{t('find.step3')}</h2>
        {!user ? <p className="muted">{t('match.signInNote')}</p> : null}
        {ranked.length === 0 ? (
          <p>{t('find.empty')}</p>
        ) : (
          <>
            <p role="status">{t('find.count', { n: ranked.length })}</p>
            <ul className="p5-grid catalogue-grid">
              {ranked.map(({ p, match }) => (
                <ProgrammeCard key={p.id} p={p} locale={locale} match={user && org ? match : null} orgId={org?.org.id ?? null} saved={savedIds.has(p.id)} />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
