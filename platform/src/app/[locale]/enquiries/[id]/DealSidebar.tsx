import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { getEnquiryWorkspace } from '@/server/services/enquiries';
import type { Db } from '@/server/services/result';
import { leadAction, referralAction, respondReferralAction, reviewAction, reviewResponseAction } from './actions';

/** Secondary tools kept from before, now inside the collapsible side panel: private lead notes, referrals and the review. */
export default async function DealSidebar({ db, enquiryId, side }: { db: Db; enquiryId: string; side: 'buyer' | 'seller' }) {
  const t = await getTranslations('p4');
  const w = await getEnquiryWorkspace(db, enquiryId);
  return (
    <>
      {side === 'seller' ? (
        <details className="deal-more"><summary>{t('lead')}</summary>
          <p className="mut">{t('sellerOnly')}</p>
          <ActionForm action={leadAction} submitLabel={t('saveLead')}>
            <input type="hidden" name="enquiryId" value={enquiryId} />
            <label htmlFor="stage">{t('stage')}</label>
            <select id="stage" name="stage" defaultValue={w.leads[0]?.stage ?? 'new'}>
              {['new', 'contacted', 'quoted', 'discussing', 'reported_won', 'reported_lost'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <label htmlFor="followUpAt">{t('followUp')}</label><input id="followUpAt" type="datetime-local" name="followUpAt" />
            <label htmlFor="lead-note">{t('note')}</label><textarea id="lead-note" name="note" maxLength={2000} />
          </ActionForm>
          {w.leads.length ? <ol>{w.leads.map((a) => <li key={a.id}>{a.stage} · {a.next_follow_up_at ? new Date(a.next_follow_up_at).toLocaleDateString() : '—'}{a.note ? <p>{a.note}</p> : null}</li>)}</ol> : null}
          <h3>{t('referral')}</h3>
          <ActionForm action={referralAction} submitLabel={t('propose')}>
            <input type="hidden" name="enquiryId" value={enquiryId} /><label htmlFor="sellerOrgId">{t('sellerOrgId')}</label><input id="sellerOrgId" name="sellerOrgId" required />
          </ActionForm>
        </details>
      ) : null}
      {w.referrals.length ? (
        <details className="deal-more"><summary>{t('referral')}</summary>
          <ul>{w.referrals.map((r) => <li key={r.id}>{r.status} · {r.proposed_seller_org_id}
            {side === 'buyer' && r.status === 'proposed' ? (
              <div>{(['accept', 'decline'] as const).map((decision) => (
                <ActionForm key={decision} action={respondReferralAction} submitLabel={decision === 'accept' ? t('consent') : t('rejectReferral')}>
                  <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="referralId" value={r.id} /><input type="hidden" name="decision" value={decision} />
                </ActionForm>))}</div>
            ) : null}</li>)}</ul>
        </details>
      ) : null}
      <details className="deal-more"><summary>{t('review')}</summary>
        <p className="mut">{t('reviewDisclaimer')}</p>
        {w.review ? (
          <>
            <p>{w.review.rating}/5 · {w.review.review_text} · {w.review.status}</p>
            {w.review.seller_response && (side === 'seller' || w.review.seller_response_status === 'published')
              ? <p>{t('sellerResponse')}: {w.review.seller_response}{side === 'seller' && w.review.seller_response_status === 'pending' ? ` · ${t('responsePending')}` : ''}</p> : null}
            {side === 'seller' && w.review.status === 'published' && !w.review.seller_response ? (
              <ActionForm action={reviewResponseAction} submitLabel={t('sendResponse')}>
                <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="reviewId" value={w.review.id} />
                <label htmlFor="seller-response">{t('sellerResponse')}</label><textarea id="seller-response" name="response" minLength={3} maxLength={2000} required />
              </ActionForm>
            ) : null}
          </>
        ) : side === 'buyer' ? (
          <ActionForm action={reviewAction} submitLabel={t('submitReview')}>
            <input type="hidden" name="enquiryId" value={enquiryId} /><label htmlFor="rating">{t('rating')}</label>
            <select id="rating" name="rating">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            <label htmlFor="review-text">{t('reviewText')}</label><textarea id="review-text" name="reviewText" minLength={10} maxLength={2000} required />
          </ActionForm>
        ) : null}
      </details>
    </>
  );
}
