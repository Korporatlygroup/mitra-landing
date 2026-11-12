import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { saveGovProgrammeAction, unsaveGovProgrammeAction } from '../actions';
import QuickForm from '@/components/catalogue/QuickForm';
import { Link } from '@/i18n/navigation';
import { matchProgramme } from '@/lib/gov-matching';
import { eligibleAssistOrgs, formatRm, safeHttpsUrl } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { getGovProfile, getGovProgramme, listGovSaved } from '@/server/services/gov';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';

const SLUG = /^[a-z0-9-]{3,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.detail.official');
}

/**
 * Programme detail. INOK's own simple summary (built only from the structured facts) is kept apart from the agency's
 * published words (shown in the original language, never retranslated). Application guidance matches the programme's
 * published channel; INOK never submits an application and never asks for a government-portal password.
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
  const savedRes = org ? await listGovSaved(supabase, org.org.id) : null;
  const saved = Boolean(savedRes?.ok && savedRes.data.some((s) => s.programme_id === p.id));
  const match = org
    ? matchProgramme(
        { verification_status: p.verification_status, application_status: p.application_status, is_stale: p.is_stale, funding_type: d.funding_type ?? null, data: { rules: d.rules ?? [] } },
        profileRes?.ok ? profileRes.data : {},
      )
    : null;

  const apply = safeHttpsUrl(d.application_url);
  const info = safeHttpsUrl(d.info_url);
  const channel = d.application_channel && ['online', 'branch', 'form', 'enquiry', 'unknown'].includes(d.application_channel) ? d.application_channel : 'unknown';
  const amount = d.amount_max ? (d.amount_min && d.amount_min !== d.amount_max ? t('card.amountRange', { min: formatRm(d.amount_min), max: formatRm(d.amount_max) }) : t('card.upTo', { max: formatRm(d.amount_max) })) : t('card.amountUnknown');

  return (
    <>
      <p>
        <Link href="/business-help/find" locale={locale}>
          {t('detail.back')}
        </Link>
      </p>
      <h1>{p.name}</h1>
      <p className="muted">
        {t('card.agency')}: {p.agency} · {t('detail.version', { n: p.version_no })}
      </p>
      <p>
        {d.funding_type ? <span className="chip">{t(`type.${d.funding_type}`)}</span> : null}{' '}
        <span className={p.application_status === 'open' ? 'chip chip-good' : p.application_status === 'closed' ? 'chip chip-bad' : 'chip'}>
          {t('card.status')}: {t(`status.${p.application_status}`)}
        </span>
      </p>
      {p.is_stale ? (
        <p className="message message-error" role="note">
          {t('detail.stale')}
        </p>
      ) : null}
      <p className="muted">
        {p.last_checked_at ? t('card.checked', { date: date(p.last_checked_at) }) : t('card.neverChecked')}
        {p.last_verified_at ? ` · ${t('card.verified', { date: date(p.last_verified_at) })}` : ''}
      </p>

      <section aria-labelledby="gov-sum-h" className="card">
        <h2 id="gov-sum-h">{t('detail.summary')}</h2>
        <p className="muted">{t('detail.officialNote')}</p>
        <dl className="catalogue-facts">
          <dt>{t('card.amount')}</dt>
          <dd>{amount}</dd>
          <dt>{t('card.importantDates')}</dt>
          <dd>{d.opens_on || d.closes_on ? [d.opens_on ? t('card.opens', { date: date(d.opens_on) }) : null, d.closes_on ? t('card.closes', { date: date(d.closes_on) }) : null].filter(Boolean).join(' · ') : t('card.noDates')}</dd>
          <dt>{t('detail.howToApply')}</dt>
          <dd>{t(`detail.channel.${channel}`)}</dd>
        </dl>
      </section>

      {match ? (
        <section aria-labelledby="gov-match-h" className="card">
          <h2 id="gov-match-h">{t('card.check')}</h2>
          <p>
            <strong>{t(`match.${match.label}`)}</strong>
          </p>
          <p>{t(`match.explain.${match.label}`)}</p>
          {match.met.length ? (
            <>
              <h3>{t('match.fits')}</h3>
              <ul>{match.met.map((q) => <li key={q} lang="ms">{q}</li>)}</ul>
            </>
          ) : null}
          {match.notMet.length ? (
            <>
              <h3>{t('match.notMet')}</h3>
              <ul>{match.notMet.map((q) => <li key={q} lang="ms">{q}</li>)}</ul>
            </>
          ) : null}
          {match.missing.length ? (
            <>
              <h3>{t('match.missing')}</h3>
              <ul>{match.missing.map((f) => <li key={f}>{t(`match.field.${f}`)}</li>)}</ul>
              <p>
                <Link href={`/business-help/find?org=${org?.org.id}`} locale={locale}>
                  {t('find.change')}
                </Link>
              </p>
            </>
          ) : null}
          {match.needsAgency.length ? (
            <>
              <h3>{t('match.agency')}</h3>
              <ul>{match.needsAgency.map((q) => <li key={q} lang="ms">{q}</li>)}</ul>
            </>
          ) : null}
          <p className="muted">{t('detail.profileHint')}</p>
        </section>
      ) : (
        <p className="muted">{t('match.signInNote')}</p>
      )}

      <section aria-labelledby="gov-off-h">
        <h2 id="gov-off-h">{t('detail.official')}</h2>
        {d.description ? <p lang="ms">{d.description}</p> : null}
        {d.rules?.length ? (
          <>
            <h3>{t('detail.requirements')}</h3>
            <p className="muted">{t('detail.requirementsNote')}</p>
            <ul>{[...new Set(d.rules.map((r) => r.quote))].map((q) => <li key={q} lang="ms">{q}</li>)}</ul>
          </>
        ) : null}
        {d.documents?.length ? (
          <>
            <h3>{t('detail.documents')}</h3>
            <ul>{d.documents.map((q) => <li key={q} lang="ms">{q}</li>)}</ul>
          </>
        ) : null}
        {d.terms?.length ? (
          <>
            <h3>{t('detail.terms')}</h3>
            <dl>
              {d.terms.map((x) => (
                <div key={x.label}>
                  <dt lang="ms">{x.label}</dt>
                  <dd lang="ms">{x.text}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
        {info ? (
          <p>
            <a href={info} target="_blank" rel="noopener noreferrer">
              {t('detail.infoLink')}
            </a>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="gov-app-h" className="card">
        <h2 id="gov-app-h">{t('detail.howToApply')}</h2>
        <p>{t(`detail.channel.${channel}`)}</p>
        <div className="catalogue-action-row">
          {channel === 'online' && apply ? (
            <a href={apply} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
              {t('detail.applyLink')}
            </a>
          ) : info ? (
            <a href={info} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
              {t('detail.infoLink')}
            </a>
          ) : null}
          {org ? (
            <QuickForm
              action={saved ? unsaveGovProgrammeAction : saveGovProgrammeAction}
              fields={{ orgId: org.org.id, programmeId: p.id }}
              label={saved ? t('card.remove') : t('card.save')}
              srName={p.name}
            />
          ) : null}
        </div>
        <p className="muted">{t('detail.noCredentials')}</p>
        <h3>{t('card.help')}</h3>
        <p>{t('detail.helpBody')}</p>
      </section>
    </>
  );
}
