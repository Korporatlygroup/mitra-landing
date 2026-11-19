import { getFormatter, getTranslations } from 'next-intl/server';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import { decodeIssueNote } from '@/lib/issue-note';
import { pageTitle } from '@/lib/metadata';
import { listOrderIssues } from '@/server/services/deals';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'deals.issuesTitle');
}

/**
 * Agreements on which a buyer or seller reported an issue. Read only: it decides nothing and touches no money.
 * The database answers not_found to anyone without the staff permission, so the page only shows what it is given.
 */
export default async function AdminIssuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/admin/issues' });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const fmt = await getFormatter({ locale });
  const r = await listOrderIssues(s.supabase);
  if (!r.ok) {
    return (
      <>
        <PageHeader title={d('issuesTitle')} />
        <p role="alert" className="message message-error">{d('issuesNoAccess')}</p>
      </>
    );
  }
  const money = (v: string) => { const [w, f = ''] = String(v).split('.'); return `${w}.${f.padEnd(2, '0')}`; };
  return (
    <>
      <PageHeader title={d('issuesTitle')} sub={d('issuesIntro')} />
      {r.data.length === 0 ? (
        <EmptyState icon="flag" title={d('issuesEmpty')} text={d('issuesIntro')} />
      ) : (
        <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.data.map((i) => {
            const n = decodeIssueNote(i.note);
            return (
              <li key={i.id} className="rrow" data-testid="issue-card">
                <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{i.reference}{n.reason ? ` · ${d(`ir_${n.reason}`)}` : ''}</h2>
                <p className="muted">
                  {d('reportedBy', { who: d(i.reported_by === 'buyer' ? 'buyer' : 'seller') })} · {fmt.dateTime(new Date(i.reported_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })}
                </p>
                {n.details ? <p>{n.details}</p> : null}
                <p className="mut">{d('buyer')}: {i.buyer_name} · {d('seller')}: {i.seller_name} · {i.currency} {money(i.total)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
