import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { decideSourceChangeAction, proposeSourceChangeAction, registerSourceAction, requestRecheckAction } from '../actions';
import AdminHelpNav from '../AdminHelpNav';
import ActionForm from '@/components/ActionForm';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.src.title');
}

interface SourceRow {
  id: string; name: string; source_type: string; adapter: string; allowed_hosts: string[]; approved_urls: string[]; refresh_interval_minutes: number;
  rate_per_minute: number; freshness_hours: number; enabled: boolean; health: string; consecutive_failures: number; last_checked_at: string | null;
  last_success_at: string | null; last_failure_at: string | null; last_error: string | null; next_check_at: string | null;
}
interface ChangeRow { id: string; source_id: string; change: Record<string, unknown>; reason: string; proposed_by: string | null; created_at: string }
interface EventRow { source_id: string; at: string; event: string; details: Record<string, unknown> | null }
interface ResultRow { source_id: string; fetched_at: string; outcome: string; url: string; evidence_excerpt: string | null }

const PER_SOURCE = 6;

/** Registered sources: health, schedule, history and problems; every change to a source needs a second administrator. */
export default async function SourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireGovAdmin(locale, '/admin/business-help/sources');
  if (!ctx.canView) notFound();
  const t = await getTranslations({ locale, namespace: 'gov.admin' });
  const fmt = await getFormatter({ locale });
  const db = ctx.session.supabase;
  const me = ctx.session.user.id;
  const when = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—');

  const [sourcesQ, changesQ] = await Promise.all([
    db.from('gov_sources').select('id, name, source_type, adapter, allowed_hosts, approved_urls, refresh_interval_minutes, rate_per_minute, freshness_hours, enabled, health, consecutive_failures, last_checked_at, last_success_at, last_failure_at, last_error, next_check_at').order('name'),
    db.from('gov_source_changes').select('id, source_id, change, reason, proposed_by, created_at').eq('status', 'pending').order('created_at').limit(50),
  ]);
  const sources = (sourcesQ.data ?? []) as SourceRow[];
  const changes = (changesQ.data ?? []) as ChangeRow[];
  const ids = sources.map((s) => s.id);
  const [eventsQ, resultsQ] = ids.length
    ? await Promise.all([
        db.from('gov_events').select('source_id, at, event, details').in('source_id', ids).order('at', { ascending: false }).limit(200),
        db.from('gov_fetch_results').select('source_id, fetched_at, outcome, url, evidence_excerpt').in('source_id', ids).in('outcome', ['parse_failed', 'rejected_content', 'gone']).order('fetched_at', { ascending: false }).limit(100),
      ])
    : [{ data: [] }, { data: [] }];
  const eventsBy = new Map<string, EventRow[]>();
  for (const e of (eventsQ.data ?? []) as EventRow[]) {
    const list = eventsBy.get(e.source_id) ?? [];
    if (list.length < PER_SOURCE) eventsBy.set(e.source_id, [...list, e]);
  }
  const errorsBy = new Map<string, ResultRow[]>();
  for (const r of (resultsQ.data ?? []) as ResultRow[]) {
    const list = errorsBy.get(r.source_id) ?? [];
    if (list.length < PER_SOURCE) errorsBy.set(r.source_id, [...list, r]);
  }
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));
  const eventLabel = (e: string) => {
    const k = `src.events.${e.replace(/\./g, '_')}`;
    return t.has(k) ? t(k) : e;
  };
  const changeValue = (k: string, v: unknown) =>
    k === 'enabled' ? t(v ? 'on' : 'off') : Array.isArray(v) ? v.map(String).join(', ') : String(v);

  return (
    <>
      <h1>{t('src.title')}</h1>
      <AdminHelpNav locale={locale} current="sources" canReview={ctx.canReview} />
      <p>{t('src.intro')}</p>
      <p>{t('src.noRecheck')}</p>

      {ctx.canSources ? (
        <section aria-labelledby="src-reg-h">
          <h2 id="src-reg-h">{t('src.registerTitle')}</h2>
          <p className="hint">{t('src.registerHint')}</p>
          <ActionForm action={registerSourceAction} submitLabel={t('src.register')} className="form form-wide">
            <input type="hidden" name="locale" value={locale} />
            <div className="field">
              <label htmlFor="rs-code">{t('src.agencyCode')}</label>
              <input id="rs-code" name="agencyCode" type="text" required maxLength={30} />
            </div>
            <div className="field">
              <label htmlFor="rs-aname">{t('src.agencyName')}</label>
              <input id="rs-aname" name="agencyName" type="text" required maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="rs-domain">{t('src.domain')}</label>
              <input id="rs-domain" name="domain" type="text" required maxLength={120} placeholder="www.example.gov.my" />
            </div>
            <div className="field">
              <label htmlFor="rs-name">{t('src.name')}</label>
              <input id="rs-name" name="name" type="text" required maxLength={160} />
            </div>
            <div className="field">
              <label htmlFor="rs-type">{t('src.typeLabel')}</label>
              <select id="rs-type" name="type" defaultValue="website">
                {(['website', 'api', 'feed', 'manual'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`src.type.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rs-adapter">{t('src.adapterLabel')}</label>
              <select id="rs-adapter" name="adapter" defaultValue="page_monitor">
                {(['page_monitor', 'tekun', 'manual'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`src.adapter.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rs-hosts">{t('src.hosts')}</label>
              <textarea id="rs-hosts" name="hosts" rows={2} required maxLength={2000} aria-describedby="rs-hosts-h" />
              <p className="hint" id="rs-hosts-h">
                {t('src.hostsHint')}
              </p>
            </div>
            <div className="field">
              <label htmlFor="rs-urls">{t('src.urls')}</label>
              <textarea id="rs-urls" name="urls" rows={3} maxLength={20000} aria-describedby="rs-urls-h" />
              <p className="hint" id="rs-urls-h">
                {t('src.urlsHint')}
              </p>
            </div>
            <div className="field">
              <label htmlFor="rs-method">{t('src.methodLabel')}</label>
              <select id="rs-method" name="method" defaultValue="public_pages">
                {(['public_pages', 'official_api', 'official_feed', 'manual_entry'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`src.method.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rs-restr">{t('src.restrictions')}</label>
              <textarea id="rs-restr" name="restrictions" rows={2} maxLength={2000} />
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section aria-labelledby="src-pend-h">
        <h2 id="src-pend-h">{t('src.pendingTitle')}</h2>
        {changes.length === 0 ? (
          <p data-testid="gov-src-pending-empty">{t('src.pendingEmpty')}</p>
        ) : (
          <ul className="card-list">
            {changes.map((c) => (
              <li key={c.id} className="card" data-source-change={c.id}>
                <h3 style={{ margin: 0 }}>{nameOf.get(c.source_id) ?? '—'}</h3>
                <p className="muted" style={{ margin: '4px 0' }}>
                  {when(c.created_at)}
                </p>
                <dl className="catalogue-facts">
                  {Object.entries(c.change).map(([k, v]) => (
                    <div key={k}>
                      <dt>{t.has(`src.changeFields.${k}`) ? t(`src.changeFields.${k}`) : k}</dt>
                      <dd style={{ overflowWrap: 'anywhere' }}>{changeValue(k, v)}</dd>
                    </div>
                  ))}
                </dl>
                <p>{c.reason}</p>
                {c.proposed_by === me ? (
                  <p role="note" data-testid="gov-src-own-change">
                    {t('src.ownChange')}
                  </p>
                ) : ctx.canSources ? (
                  (['true', 'false'] as const).map((a) => (
                    <ActionForm key={a} action={decideSourceChangeAction} submitLabel={t(a === 'true' ? 'src.approveChange' : 'src.rejectChange')} variant={a === 'true' ? 'primary' : 'secondary'}>
                      <input type="hidden" name="changeId" value={c.id} />
                      <input type="hidden" name="approve" value={a} />
                      <div className="field">
                        <label htmlFor={`sc-${a}-${c.id}`}>{t('reason')}</label>
                        <input id={`sc-${a}-${c.id}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                      </div>
                    </ActionForm>
                  ))
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="src-list-h">
        <h2 id="src-list-h">{t('src.listTitle')}</h2>
        {sources.length === 0 ? (
          <p>{t('noSources')}</p>
        ) : (
          <ul className="card-list">
            {sources.map((s) => (
              <li key={s.id} className="card" data-source-id={s.id}>
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                <p style={{ margin: '4px 0' }}>
                  <span className={s.health === 'healthy' ? 'chip chip-good' : s.health === 'unknown' ? 'chip' : 'chip chip-bad'}>
                    {t('health')}: {t(`health_${s.health}`)}
                  </span>{' '}
                  <span className="chip">{s.enabled ? t('on') : t('off')}</span>
                </p>
                <dl className="catalogue-facts">
                  <dt>{t('src.facts.adapter')}</dt>
                  <dd>{t.has(`src.adapter.${s.adapter}`) ? t(`src.adapter.${s.adapter}`) : s.adapter}</dd>
                  <dt>{t('src.facts.hosts')}</dt>
                  <dd style={{ overflowWrap: 'anywhere' }}>{s.allowed_hosts.join(', ')}</dd>
                  <dt>{t('src.facts.pages')}</dt>
                  <dd>{fmt.number(s.approved_urls.length)}</dd>
                  <dt>{t('src.facts.refresh')}</dt>
                  <dd>{t('src.minutes', { n: s.refresh_interval_minutes })}</dd>
                  <dt>{t('src.facts.rate')}</dt>
                  <dd>{t('src.perMinute', { n: s.rate_per_minute })}</dd>
                  <dt>{t('src.facts.freshness')}</dt>
                  <dd>{t('src.hours', { n: s.freshness_hours })}</dd>
                  <dt>{t('lastChecked')}</dt>
                  <dd>{when(s.last_checked_at)}</dd>
                  <dt>{t('lastSuccess')}</dt>
                  <dd>{when(s.last_success_at)}</dd>
                  <dt>{t('src.facts.lastFailure')}</dt>
                  <dd>{when(s.last_failure_at)}</dd>
                  <dt>{t('nextCheck')}</dt>
                  <dd>{when(s.next_check_at)}</dd>
                  <dt>{t('failures')}</dt>
                  <dd>{s.consecutive_failures}</dd>
                  {s.last_error ? (
                    <>
                      <dt>{t('src.facts.lastError')}</dt>
                      <dd style={{ overflowWrap: 'anywhere' }}>{s.last_error}</dd>
                    </>
                  ) : null}
                </dl>

                <h4>{t('src.errorsTitle')}</h4>
                {(errorsBy.get(s.id) ?? []).length === 0 ? (
                  <p>{t('src.errorsEmpty')}</p>
                ) : (
                  <ul>
                    {(errorsBy.get(s.id) ?? []).map((r, i) => (
                      <li key={`${r.fetched_at}-${i}`} style={{ overflowWrap: 'anywhere' }}>
                        {when(r.fetched_at)} · {t(`src.outcome.${r.outcome}`)} · {r.url}
                        {r.evidence_excerpt ? ` · ${r.evidence_excerpt.slice(0, 160)}` : ''}
                      </li>
                    ))}
                  </ul>
                )}

                <h4>{t('src.historyTitle')}</h4>
                {(eventsBy.get(s.id) ?? []).length === 0 ? (
                  <p>{t('src.historyEmpty')}</p>
                ) : (
                  <ul>
                    {(eventsBy.get(s.id) ?? []).map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        {when(e.at)} · {eventLabel(e.event)}
                        {typeof e.details?.reason === 'string' ? ` · ${e.details.reason.slice(0, 200)}` : ''}
                      </li>
                    ))}
                  </ul>
                )}

                {ctx.canSources && s.enabled ? (
                  <details>
                    <summary>{t('src.recheckTitle')}</summary>
                    <ActionForm action={requestRecheckAction} submitLabel={t('src.recheck')} variant="secondary">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="sourceId" value={s.id} />
                      <div className="field">
                        <label htmlFor={`rc-${s.id}`}>{t('reason')}</label>
                        <input id={`rc-${s.id}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                      </div>
                    </ActionForm>
                  </details>
                ) : null}

                {ctx.canSources ? (
                  <details>
                    <summary>{t('src.scheduleTitle')}</summary>
                    <ActionForm action={proposeSourceChangeAction} submitLabel={t('src.propose')} variant="secondary">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="sourceId" value={s.id} />
                      <p className="hint">{t('src.proposeNote')}</p>
                      <div className="field">
                        <label htmlFor={`sr-${s.id}`}>{t('src.refresh')}</label>
                        <input id={`sr-${s.id}`} name="refresh" type="number" min={15} max={43200} defaultValue={s.refresh_interval_minutes} />
                      </div>
                      <div className="field">
                        <label htmlFor={`sa-${s.id}`}>{t('src.rate')}</label>
                        <input id={`sa-${s.id}`} name="rate" type="number" min={1} max={60} defaultValue={s.rate_per_minute} />
                      </div>
                      <div className="field">
                        <label htmlFor={`sf-${s.id}`}>{t('src.freshness')}</label>
                        <input id={`sf-${s.id}`} name="freshness" type="number" min={1} max={8760} defaultValue={s.freshness_hours} />
                      </div>
                      <div className="field">
                        <label htmlFor={`se-${s.id}`}>{t('src.enableLabel')}</label>
                        <select id={`se-${s.id}`} name="enable" defaultValue="keep">
                          <option value="keep">{t('src.enable.keep')}</option>
                          <option value="on">{t('src.enable.on')}</option>
                          <option value="off">{t('src.enable.off')}</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`sx-${s.id}`}>{t('reason')}</label>
                        <input id={`sx-${s.id}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                      </div>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
