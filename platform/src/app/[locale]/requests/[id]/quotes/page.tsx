import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/shared/StatusBadge';
import { Link } from '@/i18n/navigation';
import { uuidSchema } from '@/lib/schemas';
import { requireSession } from '@/server/session';
import { getBuyerRequest, getEnquiryParties } from '@/server/services/directory';
import { compareQuotes, type QuoteSummary } from '@/server/services/quote-comparison';

const TONE: Record<QuoteSummary['status'], BadgeTone> = { sent: 'brand', accepted: 'green', declined: 'neutral', withdrawn: 'neutral', expired: 'gold' };

/** Quotations for one request, side by side. The table never ranks offers: it shows scope, quantity, total, validity and status so they can be compared fairly. */
export default async function CompareQuotesPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, requireOrg: true, path: `/requests/${id}/quotes` });
  const request = await getBuyerRequest(session.supabase, id);
  if (!request || !session.memberships.some((m) => m.org.id === request.buyer_org_id)) notFound();
  const t = await getTranslations({ locale, namespace: 'p4' });
  const back = (
    <Link href={`/requests/${id}`} className="btn btn-secondary">
      {t('backToRequest')}
    </Link>
  );
  const { data: enquiries } = await session.supabase.from('enquiries').select('id').eq('buyer_request_id', id).eq('buyer_org_id', request.buyer_org_id);
  const ids = (enquiries ?? []).map((e) => e.id);
  if (!ids.length)
    return (
      <>
        <PageHeader title={t('compareTitle')} sub={t('compareIntro')} actions={back} />
        <EmptyState icon="list" title={t('noQuote')} text={t('noQuoteHint')} />
      </>
    );
  const { data: quotes } = await session.supabase.from('quotations').select('id,enquiry_id,status,current_version_id').in('enquiry_id', ids).not('current_version_id', 'is', null).limit(20);
  const versionIds = (quotes ?? []).flatMap((q) => (q.current_version_id ? [q.current_version_id] : []));
  const [versions, items] = await Promise.all([
    session.supabase.from('quotation_versions').select('id,scope_text,currency,total,valid_until').in('id', versionIds),
    session.supabase.from('quotation_line_items').select('quote_version_id,quantity,unit').in('quote_version_id', versionIds),
  ]);
  const details = await Promise.all((quotes ?? []).map(async (q) => ({ q, p: await getEnquiryParties(session.supabase, q.enquiry_id) })));
  const cards: QuoteSummary[] = details.flatMap(({ q, p }) => {
    const v = versions.data?.find((x) => x.id === q.current_version_id);
    if (!v || !p.ok) return [];
    const lines = (items.data ?? []).filter((x) => x.quote_version_id === v.id);
    return [
      {
        id: q.enquiry_id,
        sellerName: p.data.seller_name ?? t('unknownSeller'),
        currency: v.currency,
        total: String(v.total),
        scope: v.scope_text,
        unit: lines.length === 1 ? lines[0].unit : 'mixed',
        quantity: lines.length === 1 ? String(lines[0].quantity) : 'multiple',
        validUntil: v.valid_until,
        status: q.status as QuoteSummary['status'],
      },
    ];
  });
  const comparison = cards.length >= 2 ? compareQuotes(cards, new Date()) : null;
  return (
    <>
      <PageHeader title={t('compareTitle')} sub={t('compareIntro')} actions={back} />
      {comparison?.reasons.length ? (
        <div className="banner" role="note" style={{ marginBottom: 16 }}>
          {t('notComparable')}: {comparison.reasons.map((reason) => t(`compareReasons.${reason}`)).join(', ')}
        </div>
      ) : null}
      {cards.length ? (
        <DataTable
          caption={t('compareTitle')}
          columns={[
            { key: 'seller', label: t('col.seller') },
            { key: 'scope', label: t('col.scope') },
            { key: 'qty', label: t('col.quantity') },
            { key: 'total', label: t('col.total'), num: true },
            { key: 'valid', label: t('col.valid') },
            { key: 'status', label: t('col.status') },
            { key: 'action', label: t('col.action') },
          ]}
          rows={cards.map((c) => ({
            id: c.id,
            cells: {
              seller: <strong>{c.sellerName}</strong>,
              scope: c.scope,
              qty: c.quantity === 'multiple' ? t('col.multiple') : `${c.quantity} ${c.unit}`,
              total: (
                <strong>
                  {c.currency} {c.total}
                </strong>
              ),
              valid: new Date(c.validUntil).toLocaleDateString(locale),
              status: <StatusBadge label={t(`quoteStatus.${c.status}`)} tone={TONE[c.status] ?? 'neutral'} />,
              action: (
                <Link href={`/enquiries/${c.id}`} locale={locale} className="btn btn-secondary btn-sm">
                  {t('viewOffer')}
                </Link>
              ),
            },
          }))}
        />
      ) : (
        <EmptyState icon="list" title={t('noQuote')} text={t('noQuoteHint')} />
      )}
    </>
  );
}
