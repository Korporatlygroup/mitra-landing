import { getTranslations } from 'next-intl/server';
import ProfileForm from '@/components/gov/ProfileForm';
import ProgrammeCard from '@/components/gov/ProgrammeCard';
import { Link } from '@/i18n/navigation';
import { matchProgramme, rankMatches, type AssistanceProfile } from '@/lib/gov-matching';
import { CATEGORIES } from '@/lib/gov-status';
import { eligibleAssistOrgs, GOV_NEEDS, NEED_TO_FUNDING, parseNeed } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, listGovProgrammes, listMyGovSaved } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';

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
  const category = (CATEGORIES as readonly string[]).includes(one('category') ?? '') ? (one('category') as string) : null;
  const q = (one('q') ?? '').trim().slice(0, 80);
  const t = await getTranslations({ locale, namespace: 'gov' });
  const { supabase, user } = await getOptionalUser();

  const memberships = supabase && user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleAssistOrgs(memberships);
  const wanted = one('org');
  const org = (wanted && uuid.test(wanted) ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;

  const profileRes = supabase && org ? await getGovProfile(supabase, org.org.id) : null;
  const profile = profileRes?.ok ? profileRes.data : null;
  const savedRes = supabase && user ? await listMyGovSaved(supabase) : null;
  const savedIds = new Set(savedRes?.ok ? savedRes.data.map((s) => s.programme_id) : []);

  const listRes = supabase ? await listGovProgrammes(supabase, { limit: 100, category, q }) : null;
  const all = listRes?.ok ? listRes.data : [];
  const types = need ? NEED_TO_FUNDING[need] : null;
  const rows = types ? all.filter((p) => p.funding_type && types.includes(p.funding_type)) : all;
  const prof: AssistanceProfile = profile ?? {};
  const ranked = rankMatches(
    rows.map((p) => ({
      p,
      programme: { verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, closes_on: p.closes_on, beneficiary_type: p.beneficiary_type, info_url: p.info_url, data: { rules: p.rules } },
      match: matchProgramme({ verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: p.funding_type, beneficiary_type: p.beneficiary_type, info_url: p.info_url, data: { rules: p.rules } }, { ...prof, needs: need ? [need] : prof.needs }),
    })),
  );

  const href = (over: { need?: string | null; category?: string | null }) => {
    const qs0 = new URLSearchParams();
    const n = over.need === undefined ? need : over.need;
    const c = over.category === undefined ? category : over.category;
    if (n) qs0.set('need', n);
    if (c) qs0.set('category', c);
    if (q) qs0.set('q', q);
    if (org) qs0.set('org', org.org.id);
    const qs = qs0.toString();
    return `/business-help/find${qs ? `?${qs}` : ''}`;
  };

  return (
    <>
      <PageHeader title={t('find.title')} />
      {one('saved') ? (
        <p role="status" className="message message-ok">
          {t('find.saved')}
        </p>
      ) : null}

      <div className="split-x split-x-left">
        <aside className="stack-x" style={{ gap: 16 }} aria-label={t('find.step1')}>
          <section className="acard" aria-labelledby="gov-need-h">
            <h2 id="gov-need-h">{t('find.step1')}</h2>
            <nav aria-label={t('find.step1')} className="fchip-row">
              <Link href={href({ need: null })} locale={locale} className="fchip" aria-current={need ? undefined : 'page'}>
                {t('find.anyNeed')}
              </Link>
              {GOV_NEEDS.map((n) => (
                <Link key={n} href={href({ need: n })} locale={locale} className="fchip" aria-current={need === n ? 'page' : undefined}>
                  {t(`need.${n}`)}
                </Link>
              ))}
            </nav>
          </section>

          {!user ? (
            <section className="acard">
              <p style={{ margin: 0 }}>{t('match.signInNote')}</p>
              <div>
                <Link href={`/login?next=${encodeURIComponent(`/${locale}${href({})}`)}`} locale={locale} className="btn btn-primary btn-sm">
                  {t('find.signIn')}
                </Link>
              </div>
            </section>
          ) : !org ? (
            <section className="acard">
              <div>
                <Link href="/orgs" locale={locale} className="btn btn-primary btn-sm">
                  {t('find.noOrg')}
                </Link>
              </div>
            </section>
          ) : (
            <section className="acard" aria-labelledby="gov-profile-h">
              <details open={!profile || profile.version === 0}>
                <summary id="gov-profile-h" style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>
                  {t('find.step2')}
                </summary>
                {orgs.length > 1 ? (
                  <p className="fchip-row" style={{ margin: '8px 0' }}>
                    {orgs.map((m) => (
                      <Link key={m.org.id} href={`/business-help/find?org=${m.org.id}${need ? `&need=${need}` : ''}`} locale={locale} className="fchip" aria-current={m.org.id === org.org.id ? 'page' : undefined}>
                        {m.org.name}
                      </Link>
                    ))}
                  </p>
                ) : null}
                <ProfileForm locale={locale} orgId={org.org.id} profile={profile} need={need} />
              </details>
            </section>
          )}
        </aside>

        <section aria-labelledby="gov-results-h" style={{ minWidth: 0 }}>
          <div className="sechead">
            <h2 id="gov-results-h">{t('find.step3')}</h2>
            <span className="mut" role="status" style={{ fontSize: '0.875rem' }}>
              {t('find.count', { n: ranked.length })}
            </span>
          </div>
          <form action={`/${locale}/business-help/find`} method="get" role="search" aria-label={t('find.searchLabel')} className="toolbar-x">
            {need ? <input type="hidden" name="need" value={need} /> : null}
            {category ? <input type="hidden" name="category" value={category} /> : null}
            {org ? <input type="hidden" name="org" value={org.org.id} /> : null}
            <div className="search-x">
              <label htmlFor="gov-q" className="p5b-sr">
                {t('find.searchLabel')}
              </label>
              <input id="gov-q" name="q" type="search" maxLength={80} defaultValue={q} placeholder={t('find.searchPlaceholder')} />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm">
              {t('find.searchButton')}
            </button>
          </form>
          <nav aria-label={t('find.categoryLabel')} className="fchip-row" style={{ marginBottom: 16 }}>
            <Link href={href({ category: null })} locale={locale} className="fchip" aria-current={category ? undefined : 'page'}>
              {t('find.anyCategory')}
            </Link>
            {CATEGORIES.map((c) => (
              <Link key={c} href={href({ category: c })} locale={locale} className="fchip" aria-current={category === c ? 'page' : undefined}>
                {t(`category.${c}`)}
              </Link>
            ))}
          </nav>
          {ranked.length === 0 ? (
            <EmptyState icon="money" title={t('find.empty')} text={t('find.step3')} />
          ) : (
            <ul className="xgrid xgrid-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {ranked.map(({ p, match }) => (
                <ProgrammeCard key={p.id} p={p} locale={locale} match={user && org ? match : null} orgId={org?.org.id ?? null} signedIn={Boolean(user)} saved={savedIds.has(p.id)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
