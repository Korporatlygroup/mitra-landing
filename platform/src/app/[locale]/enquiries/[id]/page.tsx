import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ConversationList from '@/components/messages/ConversationList';
import { initialsOf, paletteFor } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { getEnquiry, getEnquiryParties } from '@/server/services/directory';
import { requireSession } from '@/server/session';
import P4Workspace from './P4Workspace';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'enq.title');
}

/** The Phase 3 enquiry identity with its Phase 4 participant workspace, in the two-pane Messages layout. */
export default async function EnquiryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, requireOrg: true, path: `/enquiries/${id}` });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const [e, parties] = await Promise.all([getEnquiry(session.supabase, id), getEnquiryParties(session.supabase, id)]);
  if (!e || !parties.ok) notFound();
  const p = parties.data;
  const openedByYou = (e.opened_by_org_id === e.buyer_org_id) === (p.you_are === 'buyer');
  const list = await ConversationList({ db: session.supabase, locale, activeId: id });
  const pal = paletteFor(id);
  const other = p.you_are === 'buyer' ? p.seller_name : (p.buyer_name ?? t('enq.customerHidden'));

  return (
    <div className="wide">
      <div className="msg-wrap has-active">
        <div className="card msg-left">{list}</div>
        <div className="card msg-right" style={{ overflow: 'hidden' }}>
          <div className="msg-head">
            <span className="av" style={{ background: pal.tint, color: pal.c1 }} aria-hidden="true">
              {initialsOf(e.topic)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: '1.15rem' }}>{e.topic}</h1>
              <span className="mut" style={{ fontSize: '0.8125rem' }}>
                {other} · {t(`enq.statuses.${e.status}`)}
              </span>
            </div>
            <Link href="/enquiries" className="btn btn-secondary btn-sm">
              {t('biz2.messages.title')}
            </Link>
            {e.buyer_request_id && p.you_are === 'buyer' ? (
              <Link href={`/requests/${e.buyer_request_id}`} className="btn btn-secondary btn-sm">
                {t('biz2.messages.viewRequest')}
              </Link>
            ) : null}
          </div>

          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <dl className="dl" style={{ background: 'var(--bg-app)', borderRadius: 14, padding: 14 }}>
              <dt>{t('enq.buyer')}</dt>
              <dd>{p.buyer_name ?? t('enq.customerHidden')}</dd>
              <dt>{t('enq.seller')}</dt>
              <dd>
                {p.seller_slug ? (
                  <Link href={`/directory/${p.seller_slug}`} locale={locale}>
                    {p.seller_name}
                  </Link>
                ) : (
                  p.seller_name
                )}
              </dd>
              <dt>{t('enq.started')}</dt>
              <dd>{fmt.dateTime(new Date(e.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })} MYT</dd>
              <dt>{t('enq.origin')}</dt>
              <dd>{t(`enq.origins.${e.origin}`)}</dd>
              <dt>{t('enq.status')}</dt>
              <dd>{t(`enq.statuses.${e.status}`)}</dd>
            </dl>
            {e.opening_note ? (
              <section aria-labelledby="note-h">
                <h2 id="note-h" style={{ marginTop: 0, fontSize: '1rem' }}>
                  {openedByYou ? t('enq.yourNote') : t('enq.theirNote')}
                </h2>
                <p className="bub them" style={{ maxWidth: '100%', margin: 0 }}>
                  {e.opening_note}
                </p>
              </section>
            ) : null}
            <P4Workspace db={session.supabase} enquiryId={id} side={p.you_are} buyerOrgId={e.buyer_org_id} />
          </div>
        </div>
      </div>
    </div>
  );
}
