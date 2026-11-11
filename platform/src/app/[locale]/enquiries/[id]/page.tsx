import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { getEnquiry, getEnquiryParties } from '@/server/services/directory';
import { requireSession } from '@/server/session';
import P4Workspace from './P4Workspace';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'enq.title');
}

/** The Phase 3 enquiry identity with its Phase 4 participant workspace. */
export default async function EnquiryPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const session = await requireSession({ locale, path: `/enquiries/${id}` });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const [e, parties] = await Promise.all([getEnquiry(session.supabase, id), getEnquiryParties(session.supabase, id)]);
  if (!e || !parties.ok) notFound();
  const p = parties.data;
  const openedByYou = (e.opened_by_org_id === e.buyer_org_id) === (p.you_are === 'buyer');

  return (
    <>
      <h1>{e.topic}</h1>
      <dl className="dl card">
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
        <dd>{fmt.dateTime(new Date(e.created_at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC</dd>
        <dt>{t('enq.origin')}</dt>
        <dd>{t(`enq.origins.${e.origin}`)}</dd>
        <dt>{t('enq.status')}</dt>
        <dd>{t(`enq.statuses.${e.status}`)}</dd>
      </dl>
      {e.opening_note ? (
        <section aria-labelledby="note-h">
          <h2 id="note-h">{openedByYou ? t('enq.yourNote') : t('enq.theirNote')}</h2>
          <p className="card" style={{ whiteSpace: 'pre-line' }}>
            {e.opening_note}
          </p>
        </section>
      ) : null}
      <p className="link-row">
        {e.buyer_request_id && p.you_are === 'buyer' ? (
          <Link href={`/requests/${e.buyer_request_id}`} locale={locale}>
            {t('enq.openRequest')}
          </Link>
        ) : null}
      </p>
      <P4Workspace db={session.supabase} enquiryId={id} side={p.you_are} buyerOrgId={e.buyer_org_id} />
    </>
  );
}
