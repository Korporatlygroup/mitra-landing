import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { decideProposalAction } from '../../actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireGovAdmin } from '@/server/gov-admin-context';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'gov.admin.review');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const show = (v: unknown) => (v === undefined || v === null ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 1));

/**
 * One proposed change: the extracted information, a before/after comparison against the published version, the evidence
 * text that was read, and the decision form. A reason is required for every decision. Approval also needs the publish
 * permission and the publishing switch; the database refuses stale proposals and links on unapproved sites.
 */
export default async function ReviewPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireGovAdmin(locale, `/admin/business-help/review/${id}`);
  const t = await getTranslations({ locale, namespace: 'gov' });
  if (!ctx.canView) notFound();
  const db = ctx.session.supabase;
  const { data: p } = await db
    .from('gov_change_proposals')
    .select('id, kind, status, flags, diff, candidate, result_id, decision_reason')
    .eq('id', id)
    .maybeSingle();
  if (!p) notFound();
  const { data: ev } = p.result_id ? await db.from('gov_fetch_results').select('evidence_excerpt, url, fetched_at').eq('id', p.result_id).maybeSingle() : { data: null };
  const c = p.candidate as Record<string, unknown> & { review_notes?: string[]; name?: string };
  const diff = (p.diff ?? {}) as Record<string, { old: unknown; new: unknown }>;
  const open = p.status === 'pending' || p.status === 'needs_info';

  return (
    <>
      <p>
        <Link href="/admin/business-help" locale={locale}>
          {t('detail.back')}
        </Link>
      </p>
      <h1>{c.name ?? '—'}</h1>
      <p>
        <span className="chip">{t(`admin.kinds.${p.kind}`)}</span>{' '}
        {(p.flags as string[]).map((f) => (
          <span key={f} className="chip chip-bad" style={{ marginRight: 4 }}>
            {t.has(`admin.flags.${f}`) ? t(`admin.flags.${f}`) : f}
          </span>
        ))}
      </p>
      {c.review_notes?.length ? (
        <section aria-labelledby="rv-notes-h" className="card">
          <h2 id="rv-notes-h">{t('admin.notes')}</h2>
          <ul>{c.review_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      ) : null}

      {Object.keys(diff).length ? (
        <section aria-labelledby="rv-diff-h">
          <h2 id="rv-diff-h">
            {t('admin.oldValue')} / {t('admin.newValue')}
          </h2>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('admin.kind')}</th>
                <th scope="col">{t('admin.oldValue')}</th>
                <th scope="col">{t('admin.newValue')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diff).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td lang="ms">
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{show(v.old)}</pre>
                  </td>
                  <td lang="ms">
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{show(v.new)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section aria-labelledby="rv-cand-h">
        <h2 id="rv-cand-h">{t('admin.candidate')}</h2>
        <pre lang="ms" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify({ ...c, review_notes: undefined }, null, 2)}
        </pre>
      </section>

      {ev ? (
        <section aria-labelledby="rv-ev-h">
          <h2 id="rv-ev-h">{t('admin.evidence')}</h2>
          <pre lang="ms" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '24rem', overflow: 'auto' }}>
            {ev.evidence_excerpt}
          </pre>
        </section>
      ) : null}

      {open ? (
        <section aria-labelledby="rv-dec-h" className="card">
          <h2 id="rv-dec-h">{t('admin.review')}</h2>
          {(['approve', 'reject', 'needs_info'] as const).map((d) => {
            if (d === 'approve' && !ctx.canPublish) return null;
            if (d !== 'approve' && !ctx.canReview) return null;
            return (
              <ActionForm key={d} action={decideProposalAction} submitLabel={t(d === 'approve' ? 'admin.approve' : d === 'reject' ? 'admin.reject' : 'admin.needsInfo')} variant={d === 'approve' ? 'primary' : 'secondary'}>
                <input type="hidden" name="proposalId" value={p.id} />
                <input type="hidden" name="decision" value={d} />
                <input type="hidden" name="expectedStatus" value={p.status} />
                <div className="field">
                  <label htmlFor={`rv-reason-${d}`}>{t('admin.reason')}</label>
                  <input id={`rv-reason-${d}`} name="reason" type="text" required minLength={5} maxLength={1000} />
                </div>
              </ActionForm>
            );
          })}
        </section>
      ) : (
        <p role="status">
          {p.status}: {p.decision_reason}
        </p>
      )}
    </>
  );
}
