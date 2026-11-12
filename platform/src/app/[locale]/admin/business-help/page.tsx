import { getFormatter, getTranslations } from 'next-intl/server';
import { setProgrammeStateAction, setSettingAction } from './actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.title');
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

interface SourceRow { id: string; name: string; health: string; enabled: boolean; last_checked_at: string | null; last_success_at: string | null; next_check_at: string | null; consecutive_failures: number }
interface ProposalRow { id: string; kind: string; external_key: string; flags: string[]; created_at: string; candidate: { name?: string } }
interface ProgRow { id: string; name: string | null; publication_state: string; application_status: string; last_checked_at: string | null }

/** Operations overview: switches, source health, review queue, programmes. All numbers come from real rows (RLS limits them to staff). */
export default async function GovAdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireGovAdmin(locale, '/admin/business-help');
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  if (!ctx.canView) return <p role="alert">{t('admin.queueEmpty')}</p>;
  const db = ctx.session.supabase;
  const when = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—');
  const since = hoursAgo(24);

  const [settings, sources, proposals, progs, checks] = await Promise.all([
    db.from('gov_settings').select('key, enabled').order('key'),
    db.from('gov_sources').select('id, name, health, enabled, last_checked_at, last_success_at, next_check_at, consecutive_failures').order('name'),
    db.from('gov_change_proposals').select('id, kind, external_key, flags, created_at, candidate').in('status', ['pending', 'needs_info']).order('created_at').limit(50),
    db.from('gov_programmes').select('id, name, publication_state, application_status, last_checked_at').order('name').limit(100),
    db.from('gov_fetch_results').select('outcome').gte('fetched_at', since).limit(1000),
  ]);
  const checkRows = (checks.data ?? []) as { outcome: string }[];
  const failed = checkRows.filter((c) => c.outcome !== 'ok' && c.outcome !== 'unchanged').length;
  const queue = (proposals.data ?? []) as ProposalRow[];

  return (
    <>
      <h1>{t('admin.title')}</h1>

      <section aria-labelledby="gv-stats-h">
        <h2 id="gv-stats-h">{t('admin.stats')}</h2>
        <dl className="catalogue-facts">
          <dt>{t('admin.checks')}</dt>
          <dd data-testid="gov-stat-checks">{fmt.number(checkRows.length)}</dd>
          <dt>{t('admin.failedChecks')}</dt>
          <dd data-testid="gov-stat-failed">{fmt.number(failed)}</dd>
          <dt>{t('admin.pending')}</dt>
          <dd data-testid="gov-stat-pending">{fmt.number(queue.length)}</dd>
        </dl>
      </section>

      <section aria-labelledby="gv-sw-h">
        <h2 id="gv-sw-h">{t('admin.switches')}</h2>
        <ul className="card-list">
          {((settings.data ?? []) as { key: string; enabled: boolean }[]).map((s) => (
            <li key={s.key} className="card" data-setting={s.key}>
              <p style={{ margin: 0 }}>
                <strong>{t(`admin.${s.key}`)}</strong>: {s.enabled ? t('admin.on') : t('admin.off')}
              </p>
              {ctx.canSources ? (
                <ActionForm action={setSettingAction} submitLabel={s.enabled ? t('admin.turnOff') : t('admin.turnOn')} variant={s.enabled ? 'danger' : 'primary'}>
                  <input type="hidden" name="key" value={s.key} />
                  <input type="hidden" name="enabled" value={s.enabled ? 'false' : 'true'} />
                  <div className="field">
                    <label htmlFor={`sw-${s.key}`}>{t('admin.reason')}</label>
                    <input id={`sw-${s.key}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                  </div>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="gv-src-h">
        <h2 id="gv-src-h">{t('admin.sources')}</h2>
        {((sources.data ?? []) as SourceRow[]).length === 0 ? (
          <p>{t('admin.noSources')}</p>
        ) : (
          <ul className="card-list">
            {((sources.data ?? []) as SourceRow[]).map((s) => (
              <li key={s.id} className="card">
                <h3 style={{ margin: 0 }}>{s.name}</h3>
                <p style={{ margin: '4px 0' }}>
                  <span className={s.health === 'healthy' ? 'chip chip-good' : s.health === 'unknown' ? 'chip' : 'chip chip-bad'}>
                    {t('admin.health')}: {t(`admin.health_${s.health}`)}
                  </span>{' '}
                  <span className="chip">{s.enabled ? t('admin.on') : t('admin.off')}</span>
                </p>
                <dl className="catalogue-facts">
                  <dt>{t('admin.lastChecked')}</dt>
                  <dd>{when(s.last_checked_at)}</dd>
                  <dt>{t('admin.lastSuccess')}</dt>
                  <dd>{when(s.last_success_at)}</dd>
                  <dt>{t('admin.nextCheck')}</dt>
                  <dd>{when(s.next_check_at)}</dd>
                  <dt>{t('admin.failures')}</dt>
                  <dd>{s.consecutive_failures}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="gv-q-h">
        <h2 id="gv-q-h">{t('admin.queue')}</h2>
        {queue.length === 0 ? (
          <p>{t('admin.queueEmpty')}</p>
        ) : (
          <ul className="card-list">
            {queue.map((q) => (
              <li key={q.id} className="card" data-proposal={q.id}>
                <h3 style={{ margin: 0 }}>{q.candidate?.name ?? q.external_key}</h3>
                <p className="muted" style={{ margin: '4px 0' }}>
                  {t('admin.kind')}: {t(`admin.kinds.${q.kind}`)} · {when(q.created_at)}
                </p>
                {q.flags.length ? (
                  <p style={{ margin: '4px 0' }}>
                    {q.flags.map((f) => (
                      <span key={f} className="chip chip-bad" style={{ marginRight: 4 }}>
                        {t.has(`admin.flags.${f}`) ? t(`admin.flags.${f}`) : f}
                      </span>
                    ))}
                  </p>
                ) : null}
                <Link href={`/admin/business-help/review/${q.id}`} locale={locale} className="btn btn-primary">
                  {t('admin.review')}
                  <span className="p5b-sr">: {q.candidate?.name ?? q.external_key}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="gv-prog-h">
        <h2 id="gv-prog-h">{t('admin.programmes')}</h2>
        <ul className="card-list">
          {((progs.data ?? []) as ProgRow[]).map((p) => (
            <li key={p.id} className="card" data-programme-id={p.id}>
              <h3 style={{ margin: 0 }}>{p.name ?? '—'}</h3>
              <p className="muted" style={{ margin: '4px 0' }}>
                {t('admin.state')}: {p.publication_state} · {t('card.status')}: {t(`status.${p.application_status}`)} · {t('admin.lastChecked')}: {when(p.last_checked_at)}
              </p>
              {ctx.canPublish && p.publication_state !== 'archived' && p.publication_state !== 'hidden' ? (
                <ActionForm action={setProgrammeStateAction} submitLabel={p.publication_state === 'paused' ? t('admin.resume') : t('admin.pause')} variant="secondary">
                  <input type="hidden" name="programmeId" value={p.id} />
                  <input type="hidden" name="state" value={p.publication_state === 'paused' ? 'published' : 'paused'} />
                  <div className="field">
                    <label htmlFor={`pr-${p.id}`}>{t('admin.reason')}</label>
                    <input id={`pr-${p.id}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                  </div>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
