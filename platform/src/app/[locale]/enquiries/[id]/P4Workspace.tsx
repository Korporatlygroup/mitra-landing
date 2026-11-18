import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { calculateQuote } from '@/server/services/quote-calculation';
import { getEnquiryWorkspace } from '@/server/services/enquiries';
import type { Db } from '@/server/services/result';
import { messageAction, saveQuoteAction, sendQuoteAction, respondQuoteAction, withdrawQuoteAction, leadAction, referralAction, respondReferralAction, reviewAction, reviewResponseAction } from './actions';

const field = (value: unknown) => typeof value === 'string' ? value : '';
const amount = (value: string | number) => { const [whole, fraction = ''] = String(value).split('.'); return `${whole}.${fraction.padEnd(2, '0')}`; };

export default async function P4Workspace({ db, enquiryId, side, buyerOrgId }: {
  db: Db; enquiryId: string; side: 'buyer' | 'seller'; buyerOrgId: string;
}) {
  const t = await getTranslations('p4');
  const tc = await getTranslations('enq');
  const w = await getEnquiryWorkspace(db, enquiryId);
  const latest = w.versions.find((version) => version.id === w.quote?.current_version_id);
  const draft = w.draft;
  const draftLines = Array.isArray(draft?.lines) ? draft.lines as Record<string, unknown>[] : [];
  let preview: string | null = null;
  if (draft && draftLines.length) {
    try {
      preview = calculateQuote({ currency: 'MYR', lines: draftLines.map((l) => ({ description: field(l.description), quantity: field(l.quantity), unit: field(l.unit), unitPrice: field(l.unit_price) })),
        deliveryFee: field(draft.delivery_fee), taxAmount: field(draft.tax_amount) }).total;
    } catch { /* Invalid saved draft stays editable; the server rejects send. */ }
  }

  return <>
    <section aria-labelledby="conversation-title" className="conv">
      <h2 id="conversation-title" className="conv-h">{t('conversation')}</h2>
      <div className="msg-body" data-testid="conversation">
        {w.messages.length ? w.messages.map((m) => {
          const fromBuyer = m.sender_org_id === buyerOrgId;
          const mine = fromBuyer === (side === 'buyer');
          return <div key={m.id} className={mine ? 'bub me' : 'bub them'}>
            {m.body}
            <time className="bub-meta" dateTime={m.created_at}>{fromBuyer ? tc('buyer') : tc('seller')} · {new Date(m.created_at).toLocaleString()}</time>
          </div>;
        }) : <p className="mut">{t('noMessages')}</p>}
      </div>
      <div className="msg-composer">
        <ActionForm action={messageAction} submitLabel={t('sendReply')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="key" value={randomUUID()} />
          <label htmlFor="reply-body">{t('reply')}</label><textarea id="reply-body" name="body" maxLength={4000} required rows={3} />
        </ActionForm>
        <p style={{ margin: '8px 0 0' }}><a href="#quote-title" className="btn btn-secondary btn-sm">{t('quote')}</a></p>
      </div>
    </section>

    <section aria-labelledby="quote-title" className="card">
      <h2 id="quote-title">{t('quote')}</h2>
      {latest ? <>
        <p><strong>{t('version')} {latest.version_number}</strong> · {w.quote?.status} · {t('expires')} <time dateTime={latest.valid_until}>{new Date(latest.valid_until).toLocaleDateString()}</time></p>
        <p>{latest.scope_text}</p>
        <ul>{w.items.filter((i) => i.quote_version_id === latest.id).map((i) => <li key={i.id}>{i.description}: {i.quantity} {i.unit} × MYR {amount(i.unit_price)} = MYR {amount(i.line_total)}</li>)}</ul>
        <p>{t('subtotal')}: MYR {amount(latest.subtotal)} · {t('deliveryFee')}: MYR {amount(latest.delivery_fee)} · {t('taxAmount')}: MYR {amount(latest.tax_amount)}</p>
        <p><strong>{t('total')}: MYR {amount(latest.total)}</strong></p>
        <p>{latest.tax_treatment} · {latest.delivery_timing}</p>
        {latest.exclusions ? <p>{t('exclusions')}: {latest.exclusions}</p> : null}
        {latest.terms_text ? <p>{t('terms')}: {latest.terms_text}</p> : null}
        {w.quote?.status === 'accepted' ? <p className="banner">{t('selectedNotice')}</p> : null}
      </> : <p>{t('noQuote')}</p>}

      {side === 'buyer' && latest && w.quote?.status === 'sent' ? <div className="form-grid">
        <ActionForm action={respondQuoteAction} submitLabel={t('requestChange')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote.id} />
          <input type="hidden" name="versionId" value={latest.id} /><input type="hidden" name="expectedVersion" value={w.quote.version} />
          <input type="hidden" name="decision" value="request_revision" /><label htmlFor="revision-reason">{t('revisionReason')}</label>
          <textarea id="revision-reason" name="reason" minLength={3} maxLength={1000} required />
        </ActionForm>
        {(['accept', 'decline'] as const).map((decision) => <ActionForm key={decision} action={respondQuoteAction} submitLabel={t(decision)} variant={decision === 'decline' ? 'secondary' : 'primary'}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote!.id} />
          <input type="hidden" name="versionId" value={latest.id} /><input type="hidden" name="expectedVersion" value={w.quote!.version} />
          <input type="hidden" name="decision" value={decision} />
        </ActionForm>)}
      </div> : null}

      {side === 'seller' && (!w.quote || ['draft','revision_requested'].includes(w.quote.status)) ? <>
        <h3>{t('quoteBuilder')}</h3><p>{t('draftOnlySeller')}</p>
        <ActionForm action={saveQuoteAction} submitLabel={t('saveDraft')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="expectedVersion" value={w.quote?.version ?? 0} />
          <label htmlFor="scope">{t('scope')}</label><textarea id="scope" name="scope" minLength={3} maxLength={2000} required defaultValue={field(draft?.scope)} />
          {[1,2,3,4,5].map((n) => {
            const line = draftLines[n-1] ?? {};
            return <fieldset key={n}><legend>{t('description')} {n}</legend>
              <div className="field"><label htmlFor={`description${n}`}>{t('description')}</label><input id={`description${n}`} name={`description${n}`} maxLength={500} required={n===1} defaultValue={field(line.description)} /></div>
              <div className="field"><label htmlFor={`quantity${n}`}>{t('quantity')}</label><input id={`quantity${n}`} name={`quantity${n}`} inputMode="decimal" required={n===1} defaultValue={field(line.quantity)} /></div>
              <div className="field"><label htmlFor={`unit${n}`}>{t('unit')}</label><input id={`unit${n}`} name={`unit${n}`} maxLength={40} required={n===1} defaultValue={field(line.unit)} /></div>
              <div className="field"><label htmlFor={`unitPrice${n}`}>{t('unitPrice')}</label><input id={`unitPrice${n}`} name={`unitPrice${n}`} inputMode="decimal" required={n===1} defaultValue={field(line.unit_price)} /></div>
            </fieldset>;
          })}
          <label htmlFor="validUntil">{t('validUntil')}</label><input id="validUntil" type="date" name="validUntil" required defaultValue={field(draft?.valid_until).slice(0,10)} />
          <label htmlFor="deliveryTiming">{t('deliveryTiming')}</label><input id="deliveryTiming" name="deliveryTiming" minLength={3} maxLength={500} required defaultValue={field(draft?.delivery_timing)} />
          <label htmlFor="taxTreatment">{t('taxTreatment')}</label><input id="taxTreatment" name="taxTreatment" minLength={3} maxLength={500} required defaultValue={field(draft?.tax_treatment)} />
          <details><summary>{t('terms')}</summary>
            <label htmlFor="exclusions">{t('exclusions')}</label><textarea id="exclusions" name="exclusions" maxLength={2000} defaultValue={field(draft?.exclusions)} />
            <label htmlFor="deliveryFee">{t('deliveryFee')}</label><input id="deliveryFee" name="deliveryFee" inputMode="decimal" defaultValue={field(draft?.delivery_fee) || '0'} />
            <label htmlFor="taxAmount">{t('taxAmount')}</label><input id="taxAmount" name="taxAmount" inputMode="decimal" defaultValue={field(draft?.tax_amount) || '0'} />
            <label htmlFor="terms">{t('terms')}</label><textarea id="terms" name="terms" maxLength={2000} defaultValue={field(draft?.terms)} />
          </details>
        </ActionForm>
        {draft ? <div className="card"><h3>{t('preview')}</h3><p>{field(draft.scope)}</p><p>{t('total')}: MYR {preview ?? '—'}</p>
          <ActionForm action={sendQuoteAction} submitLabel={t('sendQuote')}>
            <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote!.id} />
            <input type="hidden" name="expectedVersion" value={w.quote!.version} />
          </ActionForm></div> : null}
      </> : null}
      {side === 'seller' && w.quote?.status === 'sent' ? <ActionForm action={withdrawQuoteAction} submitLabel={t('withdraw')} variant="secondary">
        <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote.id} /><input type="hidden" name="expectedVersion" value={w.quote.version} />
      </ActionForm> : null}
      {w.versions.length > 1 ? <details><summary>{t('quoteHistory')}</summary><ol>{w.versions.slice(1).map((v) => <li key={v.id}>{t('version')} {v.version_number}: MYR {amount(v.total)} · {v.scope_text}</li>)}</ol></details> : null}
    </section>

    {side === 'seller' ? <section className="card"><h2>{t('lead')}</h2><p>{t('sellerOnly')}</p>
      <ActionForm action={leadAction} submitLabel={t('saveLead')}>
        <input type="hidden" name="enquiryId" value={enquiryId} />
        <label htmlFor="stage">{t('stage')}</label><select id="stage" name="stage" defaultValue={w.leads[0]?.stage ?? 'new'}>
          {['new','contacted','quoted','discussing','reported_won','reported_lost'].map((s) => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <label htmlFor="followUpAt">{t('followUp')}</label><input id="followUpAt" type="datetime-local" name="followUpAt" />
        <label htmlFor="lead-note">{t('note')}</label><textarea id="lead-note" name="note" maxLength={2000} />
      </ActionForm>
      {w.leads.length ? <ol>{w.leads.map((a) => <li key={a.id}>{a.stage} · {a.next_follow_up_at ? new Date(a.next_follow_up_at).toLocaleDateString() : '—'}{a.note ? <p>{a.note}</p> : null}</li>)}</ol> : null}
      <h3>{t('referral')}</h3><ActionForm action={referralAction} submitLabel={t('propose')}>
        <input type="hidden" name="enquiryId" value={enquiryId} /><label htmlFor="sellerOrgId">{t('sellerOrgId')}</label><input id="sellerOrgId" name="sellerOrgId" required />
      </ActionForm>
    </section> : null}

    {w.referrals.length ? <section className="card"><h2>{t('referral')}</h2><ul>{w.referrals.map((r) => <li key={r.id}>{r.status} · {r.proposed_seller_org_id}
      {side === 'buyer' && r.status === 'proposed' ? <div>
        {(['accept','decline'] as const).map((decision) => <ActionForm key={decision} action={respondReferralAction} submitLabel={decision==='accept'?t('consent'):t('rejectReferral')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="referralId" value={r.id} /><input type="hidden" name="decision" value={decision} />
        </ActionForm>)}
      </div> : null}</li>)}</ul></section> : null}

    <section className="card"><h2>{t('review')}</h2><p>{t('reviewDisclaimer')}</p>
      {w.review ? <><p>{w.review.rating}/5 · {w.review.review_text} · {w.review.status}</p>
        {w.review.seller_response && (side === 'seller' || w.review.seller_response_status === 'published') ?
          <p>{t('sellerResponse')}: {w.review.seller_response}{side === 'seller' && w.review.seller_response_status === 'pending' ? ` · ${t('responsePending')}` : ''}</p> : null}
        {side==='seller' && w.review.status==='published' && !w.review.seller_response ? <ActionForm action={reviewResponseAction} submitLabel={t('sendResponse')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="reviewId" value={w.review.id} />
          <label htmlFor="seller-response">{t('sellerResponse')}</label><textarea id="seller-response" name="response" minLength={3} maxLength={2000} required />
        </ActionForm> : null}</> : side==='buyer' ? <ActionForm action={reviewAction} submitLabel={t('submitReview')}>
        <input type="hidden" name="enquiryId" value={enquiryId} /><label htmlFor="rating">{t('rating')}</label>
        <select id="rating" name="rating">{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <label htmlFor="review-text">{t('reviewText')}</label><textarea id="review-text" name="reviewText" minLength={10} maxLength={2000} required />
      </ActionForm> : null}
    </section>
  </>;
}
