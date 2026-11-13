import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { requireBusinessContext } from '@/server/business-context';
import { listEnquiries } from '@/server/services/directory';
import { sellerLeadMetrics } from '@/server/services/enquiries';
import ActionForm from '@/components/ActionForm';
import { respondReferralAction } from '@/app/[locale]/enquiries/[id]/actions';
import { openReferralEnquiryAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p4.leadsTitle');
}

export default async function LeadsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/leads');
  const t = await getTranslations({ locale, namespace: 'p4' });
  if (!ctx.perms.has('lead:manage')) return <p role="alert">{t('noAccess')}</p>;
  const [metrics, enquiries, activities, referrals] = await Promise.all([
    sellerLeadMetrics(ctx.session.supabase, id),
    listEnquiries(ctx.session.supabase, { sellerOrgId: id }),
    ctx.session.supabase.from('lead_activities').select('enquiry_id,stage,next_follow_up_at,recorded_at').eq('seller_org_id', id).order('recorded_at', { ascending: false }).limit(200),
    ctx.session.supabase.from('referral_suggestions').select('id,enquiry_id,status').eq('proposed_seller_org_id', id).in('status', ['buyer_consented','recipient_accepted']).order('created_at', { ascending: false }).limit(50),
  ]);
  const handoffs = new Map<string, string>();
  const referralIds = (referrals.data ?? []).map((r) => r.id);
  if (referralIds.length) {
    const { data } = await ctx.session.supabase.from('referral_handoffs').select('referral_id,enquiry_id').in('referral_id', referralIds);
    for (const h of data ?? []) handoffs.set(h.referral_id, h.enquiry_id);
  }
  const latest = new Map<string, { stage: string; next_follow_up_at: string | null }>();
  for (const row of activities.data ?? []) if (!latest.has(row.enquiry_id)) latest.set(row.enquiry_id, row);
  const m = metrics.ok ? metrics.data : null;
  return <>
    <h1>{t('leadsTitle')}</h1>
    <p>{t('metricsNote')}</p>
    {(referrals.data?.length ?? 0) > 0 ? <section className="card" aria-labelledby="referral-inbox-title">
      <h2 id="referral-inbox-title">{t('referralInbox')}</h2>
      <ul>{referrals.data!.map((r) => <li key={r.id}>
        {r.status === 'buyer_consented' ? <><p>{t('buyerConsentedReferral')}</p>
          {(['accept','decline'] as const).map((decision) => <ActionForm key={decision} action={respondReferralAction} submitLabel={decision === 'accept' ? t('acceptReferral') : t('rejectReferral')}>
            <input type="hidden" name="enquiryId" value={r.enquiry_id} /><input type="hidden" name="referralId" value={r.id} /><input type="hidden" name="decision" value={decision} />
          </ActionForm>)}</> : handoffs.has(r.id)
          ? <p>{t('referralAccepted')} <Link href={`/enquiries/${handoffs.get(r.id)}`} locale={locale}>{t('openConversation')}</Link></p>
          : <><p>{t('referralAccepted')}</p>
            <ActionForm action={openReferralEnquiryAction} submitLabel={t('startConversation')}><input type="hidden" name="referralId" value={r.id} /></ActionForm></>}
      </li>)}</ul>
    </section> : null}
    {m ? <dl className="dl card">
      <dt>{t('received')}</dt><dd>{m.enquiries_received}</dd>
      <dt>{t('answered')}</dt><dd>{m.enquiries_answered}</dd>
      <dt>{t('quotesSent')}</dt><dd>{m.quotes_sent}</dd>
      <dt>{t('medianResponse')}</dt><dd>{m.median_response_minutes === null ? t('insufficientData') : `${Math.round(m.median_response_minutes)} ${t('minutes')}`}</dd>
      <dt>{t('due')}</dt><dd>{m.follow_ups_due}</dd>
      <dt>{t('reportedWins')}</dt><dd>{m.reported_wins}</dd>
      <dt>{t('reportedLosses')}</dt><dd>{m.reported_losses}</dd>
      <dt>{t('reviewCount')}</dt><dd>{m.published_reviews}</dd>
    </dl> : <p role="alert">{t('noAccess')}</p>}
    <h2>{t('recentEnquiries')}</h2>
    {enquiries.length ? <ul className="card-list">{enquiries.map((e) => {
      const a = latest.get(e.id);
      const due = a?.next_follow_up_at && new Date(a.next_follow_up_at) <= new Date() && !['reported_won','reported_lost'].includes(a.stage);
      return <li className="card" key={e.id}><Link href={`/enquiries/${e.id}`} locale={locale}>{e.topic}</Link>
        <p>{a?.stage?.replace('_',' ') ?? t('newLead')}{due ? ` · ${t('overdue')}` : ''}</p></li>;
    })}</ul> : <p>{t('noLeads')}</p>}
  </>;
}
