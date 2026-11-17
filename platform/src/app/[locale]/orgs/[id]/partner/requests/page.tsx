import { getFormatter, getTranslations } from 'next-intl/server';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listPartnerRequests } from '@/server/services/p5-partner';
import type { SourcingStatus } from '@/server/services/p5-types';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.requests');
}

const STATUSES: SourcingStatus[] = ['submitted', 'acknowledged', 'clarification_requested', 'closed', 'withdrawn'];
const PAGE = 25;

export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePartnerContext(locale, id, '/requests');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.requests' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const te = await getTranslations({ locale, namespace: 'errors' });
  const fmt = await getFormatter({ locale });
  const status = STATUSES.includes(sp.status as SourcingStatus) ? (sp.status as SourcingStatus) : null;
  const offset = Math.max(0, Number(typeof sp.offset === 'string' ? sp.offset : 0) || 0);
  const r = await listPartnerRequests(ctx.session.supabase, id, status, offset);
  const items = r.ok ? r.data.items : [];
  const total = r.ok ? r.data.total : 0;
  const base = `/orgs/${id}/partner/requests`;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <>
      <PageHeader title={t('title')} sub={t('intro')} />
      <nav aria-label={t('filters')} className="link-row">
        <Link href={base} locale={locale} className={!status ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={!status ? 'page' : undefined}>
          {tt('all')}
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`${base}?status=${s}`} locale={locale} className={s === status ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={s === status ? 'page' : undefined}>
            {tc(`status.sourcing.${s}`)}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <p className="message message-error" role="alert">
          {te(r.errorKey)}
        </p>
      ) : null}
      {r.ok && items.length === 0 ? (
        <section>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
        </section>
      ) : (
        <ul className="card-list" data-testid="request-list">
          {items.map((q) => (
            <li key={q.id} className="card" data-testid="request-row">
              <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>
                <Link href={`${base}/${q.id}`} locale={locale}>
                  {q.reference}
                </Link>
              </h2>
              <p style={{ margin: '0 0 6px' }}>
                <StatusChip status={statusTone(q.status === 'submitted' ? 'previewed' : q.status)} label={q.status === 'submitted' ? t('statusNew') : tc(`status.sourcing.${q.status}`)} />
                <span className="muted">
                  {' '}
                  &middot; {q.buyer_name ?? t('buyerHidden')} &middot; {t('itemsCount', { n: q.item_count })}
                </span>
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {[q.supplier_name, q.destination_state, q.needed_by ? t('neededBy', { date: when(q.needed_by) }) : null, when(q.created_at)].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {total > PAGE ? (
        <nav aria-label={tt('pagination')} className="link-row">
          {offset > 0 ? (
            <Link href={`${base}?${status ? `status=${status}&` : ''}offset=${Math.max(0, offset - PAGE)}`} locale={locale} className="btn btn-secondary">
              {tt('previous')}
            </Link>
          ) : null}
          {offset + PAGE < total ? (
            <Link href={`${base}?${status ? `status=${status}&` : ''}offset=${offset + PAGE}`} locale={locale} className="btn btn-secondary">
              {tt('next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
