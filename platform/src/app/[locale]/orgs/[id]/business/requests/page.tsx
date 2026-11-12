import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { listEnquiries, listSellerRequests, type SellerInboxRow } from '@/server/services/directory';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'inbox.title');
}

const FILTERS = ['new', 'replied', 'closed', 'all'] as const;
type Filter = (typeof FILTERS)[number];

const isNew = (r: SellerInboxRow) => r.match_status === 'invited' && r.request_status === 'open';
const isReplied = (r: SellerInboxRow) => ['interested', 'question', 'declined'].includes(r.match_status);
const isClosed = (r: SellerInboxRow) => r.request_status !== 'open' || ['expired', 'withdrawn'].includes(r.match_status);

export default async function SellerInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessContext(locale, id, '/requests');
  const t = await getTranslations({ locale });
  const base = `/orgs/${id}/business`;
  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : 'new';

  if (!ctx.perms.has('request:respond')) {
    return (
      <>
        <h1>{t('inbox.title')}</h1>
        <p className="message message-error" role="alert">
          {t('errors.forbidden')}
        </p>
      </>
    );
  }

  const [all, enquiries] = await Promise.all([
    listSellerRequests(ctx.session.supabase, id, 'all'),
    listEnquiries(ctx.session.supabase, { sellerOrgId: id }),
  ]);
  const counts = { new: all.filter(isNew).length, replied: all.filter(isReplied).length, closed: all.filter(isClosed).length, all: all.length };
  const rows = all.filter((r) => (filter === 'all' ? true : filter === 'new' ? isNew(r) : filter === 'replied' ? isReplied(r) : isClosed(r)));

  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {t('listing.back')}
        </Link>
      </p>
      <h1>{t('inbox.title')}</h1>
      <p>
        <Link href={`${base}/requests/board`} locale={locale} className="btn btn-secondary">
          {t('board.link')}
        </Link>
      </p>
      <nav aria-label={t('inbox.filters')} className="link-row">
        {FILTERS.map((f) => (
          <Link key={f} href={`${base}/requests?filter=${f}`} locale={locale} className={f === filter ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={f === filter ? 'page' : undefined}>
            {t(`inbox.filter.${f}`, { n: counts[f] })}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <section>
          <h2>{t('inbox.emptyTitle')}</h2>
          <p>{filter === 'new' ? t('inbox.emptyNew') : t('inbox.emptyOther')}</p>
          <p>
            <Link href={`${base}/listing`} locale={locale}>
              {t('inbox.emptyHint')}
            </Link>
          </p>
        </section>
      ) : (
        <ul className="card-list">
          {rows.map((r) => (
            <li key={r.request_id} className="card" data-testid="inbox-row">
              <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>
                <Link href={`${base}/requests/${r.request_id}`} locale={locale}>
                  {r.title ?? t('inbox.noLongerShownShort')}
                </Link>
              </h2>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip
                  status={isNew(r) ? 'needs_info' : r.match_status === 'interested' || r.match_status === 'question' ? 'approved' : 'none'}
                  label={isClosed(r) && !isReplied(r) ? t(`inbox.status.closed`) : t(`inbox.status.${r.match_status}`)}
                />
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {[r.target_state, r.quantity ? `${r.quantity} ${r.unit ?? ''}` : null, r.needed_by ? t('inbox.by', { date: r.needed_by }) : null].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="enq-h">
        <h2 id="enq-h">{t('inbox.enquiriesTitle')}</h2>
        {enquiries.length === 0 ? (
          <p>{t('inbox.noEnquiries')}</p>
        ) : (
          <ul className="card-list">
            {enquiries.map((e) => (
              <li key={e.id} className="card">
                <Link href={`/enquiries/${e.id}`} locale={locale}>
                  {e.topic}
                </Link>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {t(`enq.statuses.${e.status}`)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
