import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { uuidSchema } from '@/lib/schemas';
import { requireSession } from '@/server/session';
import { getBuyerRequest, getEnquiryParties } from '@/server/services/directory';
import { compareQuotes, type QuoteSummary } from '@/server/services/quote-comparison';

export default async function CompareQuotesPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, path: `/requests/${id}/quotes` });
  const request = await getBuyerRequest(session.supabase, id);
  if (!request || !session.memberships.some((m) => m.org.id === request.buyer_org_id)) notFound();
  const t = await getTranslations({ locale, namespace: 'p4' });
  const { data: enquiries } = await session.supabase.from('enquiries').select('id').eq('buyer_request_id', id).eq('buyer_org_id', request.buyer_org_id);
  const ids = (enquiries ?? []).map((e) => e.id);
  if (!ids.length) return <><h1>{t('compareTitle')}</h1><p>{t('noQuote')}</p></>;
  const { data: quotes } = await session.supabase.from('quotations').select('id,enquiry_id,status,current_version_id').in('enquiry_id', ids).not('current_version_id', 'is', null).limit(20);
  const versionIds = (quotes ?? []).flatMap((q) => q.current_version_id ? [q.current_version_id] : []);
  const [versions, items] = await Promise.all([
    session.supabase.from('quotation_versions').select('id,scope_text,currency,total,valid_until').in('id', versionIds),
    session.supabase.from('quotation_line_items').select('quote_version_id,quantity,unit').in('quote_version_id', versionIds),
  ]);
  const details = await Promise.all((quotes ?? []).map(async (q) => ({ q, p: await getEnquiryParties(session.supabase, q.enquiry_id) })));
  const cards: QuoteSummary[] = details.flatMap(({ q, p }) => {
    const v = versions.data?.find((x) => x.id === q.current_version_id);
    if (!v || !p.ok) return [];
    const lines = (items.data ?? []).filter((x) => x.quote_version_id === v.id);
    return [{ id: q.enquiry_id, sellerName: p.data.seller_name ?? t('unknownSeller'), currency: v.currency, total: String(v.total),
      scope: v.scope_text, unit: lines.length === 1 ? lines[0].unit : 'mixed', quantity: lines.length === 1 ? String(lines[0].quantity) : 'multiple',
      validUntil: v.valid_until, status: q.status as QuoteSummary['status'] }];
  });
  const comparison = cards.length >= 2 ? compareQuotes(cards, new Date()) : null;
  return <>
    <h1>{t('compareTitle')}</h1><p>{t('compareIntro')}</p>
    {comparison?.reasons.length ? <div className="banner" role="note">{t('notComparable')}: {comparison.reasons.map((reason) => t(`compareReasons.${reason}`)).join(', ')}</div> : null}
    {cards.length ? <ul className="card-list">{cards.map((c) => <li className="card" key={c.id}>
      <h2>{c.sellerName}</h2><p>{c.scope}</p><p>{c.quantity} {c.unit}</p>
      <p><strong>{c.currency} {c.total}</strong> · {t('expires')} {new Date(c.validUntil).toLocaleDateString(locale)}</p>
      <p>{c.status}</p><Link href={`/enquiries/${c.id}`} locale={locale}>{t('viewOffer')}</Link>
    </li>)}</ul> : <p>{t('noQuote')}</p>}
  </>;
}
