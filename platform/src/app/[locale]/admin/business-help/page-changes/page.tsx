import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { reviewPageChangeAction } from '../actions';
import AdminHelpNav from '../AdminHelpNav';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';
import { lineDiff } from '@/server/gov/page-monitor';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.pc.title');
}

interface ChangeRow { id: string; source_id: string; url: string; old_result_id: string | null; new_result_id: string | null; created_at: string; status: string; reviewed_at: string | null; note: string | null }

/**
 * Pages the automatic check saw change. Each one waits for a person who reads the difference and records what it means.
 * Nothing on this page can change a published programme. Page text is shown as plain text only.
 */
export default async function PageChangesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ctx = await requireGovAdmin(locale, '/admin/business-help/page-changes');
  if (!ctx.canView) notFound();
  const t = await getTranslations({ locale, namespace: 'gov.admin' });
  const fmt = await getFormatter({ locale });
  const db = ctx.session.supabase;
  const when = (d: string | null) => (d ? fmt.dateTime(new Date(d), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—');

  const [pending, history, sources] = await Promise.all([
    db.from('gov_page_changes').select('id, source_id, url, old_result_id, new_result_id, created_at, status, reviewed_at, note').eq('status', 'pending').order('created_at', { ascending: false }).limit(30),
    db.from('gov_page_changes').select('id, source_id, url, old_result_id, new_result_id, created_at, status, reviewed_at, note').in('status', ['reviewed', 'dismissed']).order('reviewed_at', { ascending: false }).limit(20),
    db.from('gov_sources').select('id, name'),
  ]);
  const open = (pending.data ?? []) as ChangeRow[];
  const done = (history.data ?? []) as ChangeRow[];
  const sourceName = new Map(((sources.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const ids = open.flatMap((c) => [c.old_result_id, c.new_result_id]).filter((x): x is string => Boolean(x));
  const { data: results } = ids.length ? await db.from('gov_fetch_results').select('id, evidence_excerpt').in('id', ids) : { data: [] };
  const evidence = new Map(((results ?? []) as { id: string; evidence_excerpt: string | null }[]).map((r) => [r.id, r.evidence_excerpt ?? '']));

  return (
    <>
      <h1>{t('pc.title')}</h1>
      <AdminHelpNav locale={locale} current="pageChanges" canReview={ctx.canReview} />
      <p>{t('pc.intro')}</p>

      <section aria-labelledby="pc-open-h">
        <h2 id="pc-open-h">{t('attention.pages')}</h2>
        {open.length === 0 ? (
          <p data-testid="gov-pc-empty">{t('pc.empty')}</p>
        ) : (
          <ul className="card-list">
            {open.map((c) => {
              const oldText = c.old_result_id ? evidence.get(c.old_result_id) : undefined;
              const newText = c.new_result_id ? evidence.get(c.new_result_id) : undefined;
              const diff = oldText !== undefined && newText !== undefined ? lineDiff(oldText, newText) : null;
              return (
                <li key={c.id} className="card" data-page-change={c.id}>
                  <h3 style={{ margin: 0 }}>{sourceName.get(c.source_id) ?? '—'}</h3>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {t('pc.detected', { when: when(c.created_at) })}
                  </p>
                  <p style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>
                    {t('pc.page')}:{' '}
                    <a href={c.url} rel="noopener noreferrer" target="_blank">
                      {c.url}
                    </a>
                  </p>
                  {diff === null ? (
                    <p>{t('pc.noEvidence')}</p>
                  ) : diff.removed.length === 0 && diff.added.length === 0 ? (
                    <p>{t('pc.noDiff')}</p>
                  ) : (
                    <>
                      {diff.removed.length ? (
                        <>
                          <h4>{t('pc.removed')}</h4>
                          <pre lang="ms" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '16rem', overflow: 'auto' }}>
                            {diff.removed.map((l) => `− ${l}`).join('\n')}
                          </pre>
                        </>
                      ) : null}
                      {diff.added.length ? (
                        <>
                          <h4>{t('pc.added')}</h4>
                          <pre lang="ms" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '16rem', overflow: 'auto' }}>
                            {diff.added.map((l) => `+ ${l}`).join('\n')}
                          </pre>
                        </>
                      ) : null}
                    </>
                  )}
                  {ctx.canReview ? (
                    <>
                      <p>
                        <Link href={`/admin/business-help/programmes/new?source=${c.source_id}&info=${encodeURIComponent(c.url)}`} locale={locale} className="btn btn-secondary">
                          {t('pc.createUpdate')}
                        </Link>
                      </p>
                      {(['reviewed', 'dismissed'] as const).map((st) => (
                        <ActionForm key={st} action={reviewPageChangeAction} submitLabel={t(st === 'reviewed' ? 'pc.reviewed' : 'pc.dismiss')} variant={st === 'reviewed' ? 'primary' : 'secondary'}>
                          <input type="hidden" name="changeId" value={c.id} />
                          <input type="hidden" name="status" value={st} />
                          <div className="field">
                            <label htmlFor={`pc-${st}-${c.id}`}>{t('pc.note')}</label>
                            <input id={`pc-${st}-${c.id}`} name="note" type="text" required minLength={5} maxLength={1000} />
                          </div>
                        </ActionForm>
                      ))}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pc-hist-h">
        <h2 id="pc-hist-h">{t('pc.history')}</h2>
        {done.length === 0 ? (
          <p>{t('pc.historyEmpty')}</p>
        ) : (
          <ul className="card-list">
            {done.map((c) => (
              <li key={c.id} className="card">
                <p style={{ margin: 0 }}>
                  <strong>{sourceName.get(c.source_id) ?? '—'}</strong> · {t(`pc.st.${c.status}`)} · {when(c.reviewed_at)}
                </p>
                {c.note ? <p style={{ margin: '4px 0' }}>{c.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
