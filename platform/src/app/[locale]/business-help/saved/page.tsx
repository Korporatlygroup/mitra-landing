import { getFormatter, getTranslations } from 'next-intl/server';
import { Fragment } from 'react';
import { updateGovTrackingAction, unsaveGovProgrammeAction, unsaveMyProgrammeAction } from '../actions';
import ActionForm from '@/components/ActionForm';
import QuickForm from '@/components/catalogue/QuickForm';
import { Link } from '@/i18n/navigation';
import StatusBadge from '@/components/gov/StatusBadge';
import { eligibleAssistOrgs, TRACKING_STATUSES } from '@/lib/gov-ui';
import { pageTitle } from '@/lib/metadata';
import { listGovSaved, listMyGovSaved } from '@/server/services/gov';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.saved.title');
}

const OUTCOMES = ['approved', 'declined', 'withdrawn', 'other'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Saved opportunities and the owner's own tracking. These statuses are self-reported and are never presented as agency updates. */
export default async function SavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const session = await requireSession({ locale, path: '/business-help/saved' });
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  const orgs = eligibleAssistOrgs(session.memberships);
  const wanted = typeof sp.org === 'string' && UUID.test(sp.org) ? sp.org : null;
  const org = (wanted ? orgs.find((m) => m.org.id === wanted) : null) ?? orgs[0] ?? null;
  const res = org ? await listGovSaved(session.supabase, org.org.id) : null;
  const rows = res?.ok ? res.data : [];
  const mineRes = await listMyGovSaved(session.supabase);
  const mine = mineRes.ok ? mineRes.data : [];

  return (
    <>
      <h1>{t('saved.title')}</h1>
      <p>{t('saved.intro')}</p>
      <p className="muted">{t('saved.note')}</p>
      <section aria-labelledby="gov-me-h">
        <h2 id="gov-me-h">{t('opps.mySaved')}</h2>
        {mine.length === 0 ? (
          <p>
            {t('opps.mySavedNone')}{' '}
            <Link href="/business-help" locale={locale}>
              {t('opps.browse')}
            </Link>
          </p>
        ) : (
          <ul className="card-list">
            {mine.map((r) => (
              <li key={r.programme_id} className="card">
                <h3 style={{ margin: 0 }}>
                  <Link href={`/business-help/${r.slug}`} locale={locale}>
                    {r.name}
                  </Link>
                </h3>
                <p className="muted" style={{ margin: '2px 0' }}>
                  {r.agency_name} · {r.funding_type ? t(`type.${r.funding_type}`) : '-'} · {t(`status.${r.application_status}`)}
                  {r.closes_on ? ` · ${fmt.dateTime(new Date(`${r.closes_on}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })}` : ''}
                </p>
                <QuickForm action={unsaveMyProgrammeAction} fields={{ programmeId: r.programme_id }} label={t('card.remove')} srName={r.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {!org ? (
        <p>
          <Link href="/orgs" locale={locale}>
            {t('opps.trackNeedsBusiness')}
          </Link>
        </p>
      ) : rows.length === 0 ? (
        <section aria-labelledby="gov-sv-none">
          <h2 id="gov-sv-none">{t('saved.empty')}</h2>
          <p>
            <Link href="/business-help/find" locale={locale} className="btn btn-primary">
              {t('saved.browse')}
            </Link>
          </p>
        </section>
      ) : (
        <ul className="card-list">
          {rows.map((r) => (
            <li key={r.programme_id} className="card" data-programme={r.slug}>
              <h2 style={{ marginTop: 0 }}>
                <Link href={`/business-help/${r.slug}?org=${org.org.id}`} locale={locale}>
                  {r.name}
                </Link>
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                {t('card.agency')}: {r.agency_name}
              </p>
              <p>
                <StatusBadge
                  locale={locale}
                  input={{ publication_state: r.publication_state, verification_status: 'verified', application_status: r.application_status, closes_on: r.closes_on, is_stale: r.is_stale }}
                />{' '}
                {r.closes_on ? <span className="chip">{t('card.closes', { date: fmt.dateTime(new Date(r.closes_on), { dateStyle: 'medium', timeZone: 'UTC' }) })}</span> : null}
              </p>
              {r.rules_changed ? (
                <p className="message message-error" role="note">
                  {t('saved.changed')}
                </p>
              ) : null}
              {r.publication_state !== 'published' ? (
                <p className="message message-error" role="note">
                  {t('saved.unavailable')}
                </p>
              ) : r.is_stale ? (
                <p className="muted">{t('card.stale')}</p>
              ) : null}
              <p className="muted" style={{ margin: 0 }}>
                {t('saved.reportedNote')}
              </p>
              <ActionForm action={updateGovTrackingAction} submitLabel={t('saved.update')} variant="secondary">
                {/* The fields are keyed by the stored version: after a save they are rebuilt from the refreshed row, so a runtime that delivers the
                    refreshed page after React has reset the form (seen on Cloudflare Workers) cannot leave the old stage showing. The form itself
                    (and its "Updated." message) is not remounted. */}
                <Fragment key={`${r.programme_id}:${r.version}`}>
                {r.rules_changed ? (
                  <div className="field field-check">
                    <input id={`ms-${r.slug}`} type="checkbox" name="markSeen" />
                    <label htmlFor={`ms-${r.slug}`}>{t('saved.markSeen')}</label>
                  </div>
                ) : null}
                <input type="hidden" name="orgId" value={org.org.id} />
                <input type="hidden" name="programmeId" value={r.programme_id} />
                <input type="hidden" name="version" value={String(r.version)} />
                <div className="field">
                  <label htmlFor={`st-${r.slug}`}>{t('saved.statusLabel')}</label>
                  <select id={`st-${r.slug}`} name="tracking_status" defaultValue={r.tracking_status}>
                    {TRACKING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`saved.status.${s}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`ap-${r.slug}`}>{t('saved.appliedOn')}</label>
                  <input id={`ap-${r.slug}`} name="applied_on" type="date" defaultValue={r.applied_on ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor={`oc-${r.slug}`}>{t('saved.outcomeLabel')}</label>
                  <select id={`oc-${r.slug}`} name="outcome" defaultValue={r.outcome ?? ''}>
                    <option value="">—</option>
                    {OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {t(`saved.outcome.${o}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`rm-${r.slug}`}>{t('saved.reminder')}</label>
                  <input id={`rm-${r.slug}`} name="reminder_on" type="date" defaultValue={r.reminder_on ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor={`nt-${r.slug}`}>{t('saved.notes')}</label>
                  <textarea id={`nt-${r.slug}`} name="note" maxLength={500} rows={2} defaultValue={r.note ?? ''} />
                </div>
                </Fragment>
              </ActionForm>
              <p>
                <Link href={`/business-help/${r.slug}?org=${org.org.id}#gov-app-h`} locale={locale}>
                  {t('saved.officialInstructions')}
                  <span className="p5b-sr">: {r.name}</span>
                </Link>
              </p>
              <QuickForm action={unsaveGovProgrammeAction} fields={{ orgId: org.org.id, programmeId: r.programme_id }} label={t('card.remove')} srName={r.name} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
