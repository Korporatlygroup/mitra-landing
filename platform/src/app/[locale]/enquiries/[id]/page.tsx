import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ConversationList from '@/components/messages/ConversationList';
import { initialsOf, paletteFor } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { getEnquiry, getEnquiryParties } from '@/server/services/directory';
import { requireSession } from '@/server/session';
import DetailsPanel from '@/components/deals/DetailsPanel';
import { getOrderForEnquiry } from '@/server/services/deals';
import DealSidebar from './DealSidebar';
import P4Workspace from './P4Workspace';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'enq.title');
}

/** The Phase 3 enquiry identity with its Phase 4 participant workspace, in the two-pane Messages layout. */
export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ before?: string }> }) {
  const { locale, id } = await params;
  const { before } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, requireOrg: true, path: `/enquiries/${id}` });
  const t = await getTranslations({ locale });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const fmt = await getFormatter({ locale });
  const [e, parties, order] = await Promise.all([getEnquiry(session.supabase, id), getEnquiryParties(session.supabase, id), getOrderForEnquiry(session.supabase, id)]);
  if (!e || !parties.ok) notFound();
  const p = parties.data;
  const beforeIso = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
  const list = await ConversationList({ db: session.supabase, locale, activeId: id });
  const pal = paletteFor(id);
  const other = p.you_are === 'buyer' ? p.seller_name : (p.buyer_name ?? t('enq.customerHidden'));

  return (
    <div className="wide">
      <div className="msg-wrap has-active deal-wrap">
        <div className="card msg-left">{list}</div>
        <div className="card msg-right" style={{ overflow: 'hidden' }}>
          <div className="msg-head">
            <Link href="/enquiries" className="btn btn-secondary btn-sm deal-back" aria-label={d('back')}>← <span>{d('back')}</span></Link>
            <span className="av" style={{ background: pal.tint, color: pal.c1 }} aria-hidden="true">{initialsOf(e.topic)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: '1.1rem' }}>{e.topic}</h1>
              <span className="mut" style={{ fontSize: '0.8125rem' }}>{other} · {t(`enq.statuses.${e.status}`)}</span>
            </div>
            {order ? <Link href={`/orders/${order.id}`} className="btn btn-primary btn-sm">{d('viewOrder')}</Link> : null}
          </div>
          <P4Workspace db={session.supabase} enquiryId={id} side={p.you_are} buyerOrgId={e.buyer_org_id} sellerName={p.seller_name ?? ''} before={beforeIso} />
        </div>
        <DetailsPanel showLabel={d('showDetails')} hideLabel={d('hideDetails')}>
          <h2 className="deal-panel-h">{d('details')}</h2>
          <dl className="dl">
            <dt>{t('enq.buyer')}</dt><dd>{p.buyer_name ?? t('enq.customerHidden')}</dd>
            <dt>{t('enq.seller')}</dt>
            <dd>{p.seller_slug ? <Link href={`/directory/${p.seller_slug}`} locale={locale}>{p.seller_name}</Link> : p.seller_name}</dd>
            <dt>{d('product')}</dt><dd>{e.topic}</dd>
            <dt>{t('enq.started')}</dt>
            <dd>{fmt.dateTime(new Date(e.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })} MYT</dd>
            <dt>{t('enq.status')}</dt><dd>{t(`enq.statuses.${e.status}`)}</dd>
            {order ? <><dt>{d('reference')}</dt><dd><Link href={`/orders/${order.id}`}>{order.reference}</Link></dd></> : null}
          </dl>
          {e.buyer_request_id && p.you_are === 'buyer' ? <p><Link href={`/requests/${e.buyer_request_id}`} className="btn btn-secondary btn-sm">{t('biz2.messages.viewRequest')}</Link></p> : null}
          {e.opening_note ? <p className="mut">{e.opening_note}</p> : null}
          <p className="mut"><strong>{d('helpLinks')}</strong><br />
            {p.seller_slug ? <><Link href={`/directory/${p.seller_slug}`} locale={locale}>{d('verifyLink')}</Link><br /></> : null}
            <Link href="/complaints" locale={locale}>{d('reportLink')}</Link></p>
          <DealSidebar db={session.supabase} enquiryId={id} side={p.you_are} />
        </DetailsPanel>
      </div>
    </div>
  );
}
