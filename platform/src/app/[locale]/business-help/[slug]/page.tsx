import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { saveMyProgrammeAction, unsaveMyProgrammeAction } from '../actions';
import QuickForm from '@/components/catalogue/QuickForm';
import MatchExplanation from '@/components/gov/MatchExplanation';
import StatusBadge from '@/components/gov/StatusBadge';
import { Link } from '@/i18n/navigation';
import { matchProgramme } from '@/lib/gov-matching';
import { categoryOf, displayStatus } from '@/lib/gov-status';
import { eligibleAssistOrgs, formatRm, safeHttpsUrl, textLang } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, getGovProgramme, listMyGovSaved } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';
import PageHeader from '@/components/shared/PageHeader';

const SLUG = /^[a-z0-9-]{3,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.detail.official');
}

/**
 * Programme detail. INOK's own simple facts are kept apart from the agency's published words (shown in the original language,
 * never retranslated, and labelled as such). Application guidance matches the programme's published channel; INOK never submits an
 * application and never asks for a government-portal password. Anything the agency has not published reads "Not confirmed".
 */
export default async function ProgrammePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const date = (d: string) => fmt.dateTime(new Date(d), { dateStyle: 'medium', timeZone: 'UTC' });
  const { supabase, user } = await getOptionalUser();
  if (!supabase) notFound();
  const res = await getGovProgramme(supabase, slug);
  if (!res.ok) notFound();
  const p = res.data;
  const d = p.data;

  const memberships = user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleAssistOrgs(memberships);
  const wanted = typeof sp.org === 'string' && UUID.test(sp.org) ? sp.org : null;
  const org = (wanted ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;
  const profileRes = org ? await getGovProfile(supabase, org.org.id) : null;
  const profile = profileRes?.ok ? profileRes.data : null;
  const savedRes = user ? await listMyGovSaved(supabase) : null;
  const saved = Boolean(savedRes?.ok && savedRes.data.some((s) => s.programme_id === p.id));
  const match = org
    ? matchProgramme(
        {
          verification_status: p.verification_status,
          application_status: p.application_status,
          is_stale: p.is_stale,
          funding_type: d.funding_type ?? null,
          closes_on: d.closes_on ?? null,
          beneficiary_type: d.beneficiary_type ?? null,
          info_url: d.info_url,
          data: { rules: d.rules ?? [] },
        },
        profile ?? {},
      )
    : null;
  const answered = Boolean(profile && (profile.business_size || profile.employees != null || profile.years_operating != null || profile.registration || profile.state));

  const statusInput = { verification_status: p.verification_status, application_status: p.application_status, closes_on: d.closes_on ?? null, is_stale: p.is_stale };
  const shown = displayStatus(statusInput);
  const apply = safeHttpsUrl(d.application_url);
  const info = safeHttpsUrl(d.info_url);
  const channel = d.application_channel && ['online', 'branch', 'form', 'enquiry', 'unknown'].includes(d.application_channel) ? d.application_channel : 'unknown';
  const amount = d.amount_max
    ? d.amount_min && d.amount_min !== d.amount_max
      ? t('card.amountRange', { min: formatRm(d.amount_min), max: formatRm(d.amount_max) })
      : t('card.upTo', { max: formatRm(d.amount_max) })
    : t('detail.notConfirmed');
  const notConfirmed = t('detail.notConfirmed');
  const wording = textLang([d.description, ...(d.rules ?? []).map((r) => r.quote)].join(' '));
  const beneficiary = d.beneficiary_type ? t(`detail.beneficiary.${d.beneficiary_type}`) : notConfirmed;
  const loginNext = `/login?next=${encodeURIComponent(`/${locale}/business-help/${slug}`)}`;
  const canApplyOnline = channel === 'online' && apply && shown !== 'closed';

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/business-help/find" locale={locale}>
            {t('detail.back')}
          </Link>
        }
        title={p.name}
        sub={`${t('card.agency')}: ${p.agency} · ${t('detail.version', { n: p.version_no })}`}
        actions={
          <>
            {org && answered ? (
              <a href="#gov-match" className="btn btn-secondary">
                {t('detail.checkButton')}
              </a>
            ) : org ? (
              <Link href={`/business-help/find?org=${org.org.id}`} locale={locale} className="btn btn-secondary">
                {t('detail.checkButton')}
              </Link>
            ) : (
              <Link href={loginNext} locale={locale} className="btn btn-secondary">
                {t('detail.checkButton')}
              </Link>
            )}
            {user ? (
              <QuickForm
                action={saved ? unsaveMyProgrammeAction : saveMyProgrammeAction}
                fields={{ programmeId: p.id }}
                label={saved ? t('card.remove') : t('card.save')}
                srName={p.name}
              />
            ) : null}
            {canApplyOnline ? (
              <a href={apply} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                {t('detail.applyOfficial')}
              </a>
            ) : info ? (
              <a href={info} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                {t('detail.infoLink')}
              </a>
            ) : null}
          </>
        }
      />
      <p className="pcard-chips" style={{ margin: '0 0 12px' }}>
        <span className="chip-x brand">{t(`category.${categoryOf({ category: d.category, funding_type: d.funding_type })}`)}</span>
        <StatusBadge locale={locale} input={statusInput} />
        {d.beneficiary_type === 'organisation' ? <span className="chip-x gold">{t('match.for_organisations')}</span> : null}
        <span className="mut" style={{ fontSize: '0.8125rem' }}>
          {p.last_checked_at ? t('card.checked', { date: date(p.last_checked_at) }) : t('card.neverChecked')}
          {p.last_verified_at ? ` · ${t('card.verified', { date: date(p.last_verified_at) })}` : ''}
        </span>
      </p>
      {shown === 'closed' ? (
        <p className="message message-error" role="note">
          {t('detail.closedNote')}
        </p>
      ) : p.is_stale ? (
        <p className="message message-error" role="note">
          {t('detail.stale')}
        </p>
      ) : null}

      <section aria-labelledby="gov-offer-h" className="card">
        <h2 id="gov-offer-h">{t('detail.offers')}</h2>
        <p className="muted">{t('detail.officialNote')}</p>
        <dl className="catalogue-facts">
          <dt>{t('detail.type')}</dt>
          <dd>{d.funding_type ? t(`type.${d.funding_type}`) : notConfirmed}</dd>
          <dt>{t('card.amount')}</dt>
          <dd>{amount}</dd>
        </dl>
        {d.description ? (
          <>
            <h3>{t('detail.originalWording', { language: t(`detail.lang.${wording}`) })}</h3>
            <p lang={wording}>{d.description}</p>
            {locale !== wording ? <p className="muted">{t('detail.fallbackNote', { language: t(`detail.lang.${wording}`) })}</p> : null}
          </>
        ) : null}
      </section>

      <section aria-labelledby="gov-who-h">
        <h2 id="gov-who-h">{t('detail.whoFor')}</h2>
        <dl className="catalogue-facts">
          <dt>{t('detail.beneficiaryLabel')}</dt>
          <dd>{beneficiary}</dd>
          <dt>{t('detail.sectors')}</dt>
          <dd>{d.sectors?.length ? d.sectors.join(', ') : notConfirmed}</dd>
          <dt>{t('detail.states')}</dt>
          <dd>{d.states?.length ? d.states.join(', ') : notConfirmed}</dd>
        </dl>
        {d.beneficiary_type === 'organisation' ? (
          <p className="message" role="note">
            {t('detail.organisationNote')}
          </p>
        ) : null}
        <h3>{t('detail.requirements')}</h3>
        {d.rules?.length ? (
          <>
            <p className="muted">{t('detail.requirementsNote')}</p>
            <ul>
              {[...new Set(d.rules.map((r) => r.quote))].map((q) => (
                <li key={q} lang={textLang(q)}>
                  {q}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{notConfirmed}</p>
        )}
      </section>

      {match && org ? (
        <MatchExplanation match={match} locale={locale} orgId={org.org.id} />
      ) : (
        <section aria-labelledby="gov-check-h" className="card" id="gov-match">
          <h2 id="gov-check-h">{t('card.check')}</h2>
          <p>{t('match.signInNote')}</p>
          <p className="muted">{t('match.disclaimer')}</p>
          <Link href={loginNext} locale={locale} className="btn btn-secondary">
            {t('match.signInButton')}
          </Link>
        </section>
      )}

      <section aria-labelledby="gov-docs-h">
        <h2 id="gov-docs-h">{t('detail.documentsToPrepare')}</h2>
        {d.documents?.length ? (
          <ul>
            {d.documents.map((q) => (
              <li key={q} lang={textLang(q)}>
                {q}
              </li>
            ))}
          </ul>
        ) : (
          <p>{notConfirmed}</p>
        )}
      </section>

      <section aria-labelledby="gov-dates-h">
        <h2 id="gov-dates-h">{t('detail.dates')}</h2>
        <dl className="catalogue-facts">
          <dt>{t('detail.opensLabel')}</dt>
          <dd>{d.opens_on ? date(d.opens_on) : notConfirmed}</dd>
          <dt>{t('detail.closesLabel')}</dt>
          <dd>{d.closes_on ? date(d.closes_on) : notConfirmed}</dd>
        </dl>
        {d.terms?.length ? (
          <>
            <h3>{t('detail.terms')}</h3>
            <dl>
              {d.terms.map((x) => (
                <div key={x.label}>
                  <dt lang={textLang(x.label)}>{x.label}</dt>
                  <dd lang={textLang(x.text)}>{x.text}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </section>

      <section aria-labelledby="gov-app-h" className="card">
        <h2 id="gov-app-h">{t('detail.howToApply')}</h2>
        <p>{t(`detail.channel.${channel}`)}</p>
        {canApplyOnline ? (
          <div className="catalogue-action-row">
            <a href={apply} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
              {t('detail.applyLink')}
            </a>
          </div>
        ) : null}
        <p className="muted">{t('detail.noCredentials')}</p>
        <h3>{t('card.help')}</h3>
        <p>{t('detail.helpBody')}</p>
      </section>

      <section aria-labelledby="gov-src-h">
        <h2 id="gov-src-h">{t('detail.sourceTitle')}</h2>
        <p>
          {p.last_verified_at ? t('card.verified', { date: date(p.last_verified_at) }) : t('detail.notVerifiedYet')}
          {p.last_checked_at ? ` · ${t('card.checked', { date: date(p.last_checked_at) })}` : ''}
        </p>
        {info ? (
          <p>
            <a href={info} target="_blank" rel="noopener noreferrer">
              {t('detail.infoLink')}
            </a>
          </p>
        ) : null}
      </section>
    </>
  );
}
