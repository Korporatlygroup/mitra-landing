import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { setProgrammeStateAction, setSettingAction } from './actions';
import AdminHelpNav from './AdminHelpNav';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.title');
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const olderThanHours = (iso: string | null, h: number) => !iso || Date.parse(iso) < Date.now() - h * 3600_000;

interface SourceRow { id: string; name: string; health: string; enabled: boolean; last_checked_at: string | null; last_success_at: string | null; next_check_at: string | null; consecutive_failures: number; freshness_hours: number }
interface ProposalRow { id: string; kind: string; external_key: string; flags: string[]; created_at: string; candidate: { name?: string } }
interface ProgRow { id: string; source_id: string; name: string | null; publication_state: string; application_status: string; last_checked_at: string | null }

/** Operations overview: switches, source health, review queue, programmes. All numbers come from real rows (RLS limits them to staff). */
export default async function GovAdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireGovAdmin(locale, '/admin/business-help');
  const t = await getTranslations({ locale, namespace: 'gov' });
  const fmt = await getFormatter({ locale });
  if (!ctx.canView) notFound();
  const db = ctx.session.supabase;
  const when = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—');
  const since = hoursAgo(24);

  const [settings, sources, proposals, progs, checks, dead, pageChanges] = await Promise.all([
    db.from('gov_settings').select('key, enabled').order('key'),
    db.from('gov_sources').select('id, name, health, enabled, last_checked_at, last_success_at, next_check_at, consecutive_failures, freshness_hours').order('name'),
    db.from('gov_change_proposals').select('id, kind, external_key, flags, created_at, candidate').in('status', ['pending', 'needs_info']).order('created_at').limit(50),
    db.from('gov_programmes').select('id, source_id, name, publication_state, application_status, last_checked_at').order('name').limit(100),
    db.from('gov_fetch_results').select('outcome').gte('fetched_at', since).limit(1000),
    db.from('gov_fetch_jobs').select('id', { count: 'exact', head: true }).eq('status', 'dead'),
    db.from('gov_page_changes').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const checkRows = (checks.data ?? []) as { outcome: string }[];
  const failed = checkRows.filter((c) => c.outcome !== 'ok' && c.outcome !== 'unchanged').length;
  const queue = (proposals.data ?? []) as ProposalRow[];
  const sourceRows = (sources.data ?? []) as SourceRow[];
  const progRows = (progs.data ?? []) as ProgRow[];
  const freshness = new Map(sourceRows.map((s) => [s.id, s.freshness_hours]));
  const staleCount = progRows.filter((p) => {
    if (p.publication_state !== 'published') return false;
    return olderThanHours(p.last_checked_at, freshness.get(p.source_id) ?? 72);
  }).length;
  const attention = [
    { key: 'sources', n: sourceRows.filter((s) => s.health === 'degraded' || s.health === 'failing').length, href: '/admin/business-help/sources' },
    { key: 'dead', n: dead.count ?? 0, href: '/admin/business-help/sources' },
    { key: 'stale', n: staleCount, href: '#gv-prog-h' },
    { key: 'pages', n: pageChanges.count ?? 0, href: '/admin/business-help/page-changes' },
    { key: 'proposals', n: queue.length, href: '#gv-q-h' },
  ].filter((a) => a.n > 0);

  return (
    <>
      <h1>{t('admin.title')}</h1>
      <AdminHelpNav locale={locale} current="home" canReview={ctx.canReview} />

      <section aria-labelledby="gv-att-h" data-testid="gov-attention">
        <h2 id="gv-att-h">{t('admin.attention.title')}</h2>
        {attention.length === 0 ? (
          <p>{t('admin.attention.none')}</p>
        ) : (
          <ul className="card-list">
            {attention.map((a) => (
              <li key={a.key} className="card" data-attention={a.key}>
                <p style={{ margin: 0 }}>
                  <strong>{fmt.number(a.n)}</strong> {t(`admin.attention.${a.key}`)}{' '}
                  <Link href={a.href} locale={locale}>
                    {t('admin.attention.open')}
                    <span className="p5b-sr">: {t(`admin.attention.${a.key}`)}</span>
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

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
        <p>
          <Link href="/admin/business-help/sources" locale={locale}>
            {t('admin.manageSources')}
          </Link>
        </p>
        {sourceRows.length === 0 ? (
          <p>{t('admin.noSources')}</p>
        ) : (
          <ul className="card-list">
            {sourceRows.map((s) => (
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
          {progRows.map((p) => (
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
              {ctx.canReview && p.publication_state !== 'hidden' ? (
                <p style={{ margin: '8px 0 0' }}>
                  <Link href={`/admin/business-help/programmes/${p.id}/edit`} locale={locale} className="btn btn-secondary">
                    {t('admin.edit')}
                    <span className="p5b-sr">: {p.name ?? ''}</span>
                  </Link>
                </p>
              ) : null}
              {ctx.canPublish && (p.publication_state === 'published' || p.publication_state === 'paused') ? (
                <ActionForm action={setProgrammeStateAction} submitLabel={t('admin.archiveConfirm')} variant="danger">
                  <p className="hint">{t('admin.archiveHelp')}</p>
                  <input type="hidden" name="programmeId" value={p.id} />
                  <input type="hidden" name="state" value="archived" />
                  <div className="field">
                    <label htmlFor={`ar-${p.id}`}>{t('admin.reason')}</label>
                    <input id={`ar-${p.id}`} name="reason" type="text" required minLength={5} maxLength={1000} />
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
