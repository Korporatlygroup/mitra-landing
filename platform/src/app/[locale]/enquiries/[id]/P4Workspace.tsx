import { randomUUID } from 'node:crypto';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import BookingTerms from '@/components/deals/BookingTerms';
import QuoteDialog from '@/components/deals/QuoteDialog';
import { Link } from '@/i18n/navigation';
import { decodeIssueNote } from '@/lib/issue-note';
import { formatMyt } from '@/lib/time';
import { CANCELLATION_OPTIONS, listDealEvents } from '@/server/services/deals';
import { getEnquiryWorkspace, type QuoteVersionRow } from '@/server/services/enquiries';
import { calculateQuote } from '@/server/services/quote-calculation';
import type { Db } from '@/server/services/result';
import { messageAction, saveQuoteAction, sendQuoteAction, respondQuoteAction, withdrawQuoteAction } from './actions';

const field = (value: unknown) => (typeof value === 'string' ? value : '');
const amount = (value: string | number) => { const [whole, fraction = ''] = String(value).split('.'); return `${whole}.${fraction.padEnd(2, '0')}`; };

type Item =
  | { at: string; kind: 'msg'; id: string; body: string; fromBuyer: boolean }
  | { at: string; kind: 'quote'; id: string; version: QuoteVersionRow }
  | { at: string; kind: 'event'; id: string; event: string; orderId: string | null; note: string | null };

/**
 * The conversation: messages, quotation cards and real transaction events in time order, then the composer. Every card and event
 * comes from a stored record (messages, quotation versions, deal_events); nothing is invented for display.
 */
export default async function P4Workspace({ db, enquiryId, side, buyerOrgId, sellerName, before }: {
  db: Db; enquiryId: string; side: 'buyer' | 'seller'; buyerOrgId: string; sellerName: string; before?: string | null;
}) {
  const t = await getTranslations('p4');
  const d = await getTranslations('deals');
  const tc = await getTranslations('enq');
  const locale = await getLocale();
  const fmt = await getFormatter({ locale });
  const noteText = (n: string) => { const x = decodeIssueNote(n); return x.reason ? `${d(`ir_${x.reason}`)}: ${x.details}` : n; };
  const [w, events] = await Promise.all([getEnquiryWorkspace(db, enquiryId, before), listDealEvents(db, enquiryId)]);
  const draft = w.draft;
  const draftLines = Array.isArray(draft?.lines) ? (draft.lines as Record<string, unknown>[]) : [];
  const nowMs = new Date().getTime();
  let preview: string | null = null;
  if (draft && draftLines.length) {
    try {
      preview = calculateQuote({ currency: 'MYR', lines: draftLines.map((l) => ({ description: field(l.description), quantity: field(l.quantity), unit: field(l.unit), unitPrice: field(l.unit_price) })),
        deliveryFee: field(draft.delivery_fee), taxAmount: field(draft.tax_amount) }).total;
    } catch { /* an invalid saved draft stays editable; the server rejects sending it */ }
  }

  const firstShown = w.messages[0]?.created_at ?? null;
  const items: Item[] = [
    ...w.messages.map((m): Item => ({ at: m.created_at, kind: 'msg', id: m.id, body: m.body, fromBuyer: m.sender_org_id === buyerOrgId })),
    ...events.filter((e) => !(w.hasEarlier || before) || !firstShown || e.created_at >= firstShown).flatMap((e): Item[] => {
      if (e.kind === 'quote.sent') {
        const v = w.versions.find((x) => x.id === e.ref_id);
        return v ? [{ at: e.created_at, kind: 'quote', id: e.id, version: v }] : [];
      }
      return [{ at: e.created_at, kind: 'event', id: e.id, event: e.kind, orderId: e.order_id, note: e.note }];
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const statusOf = (v: QuoteVersionRow): { key: string; actionable: boolean } => {
    if (v.id !== w.quote?.current_version_id) return { key: 'outdated', actionable: false };
    if (w.quote.status === 'sent' && new Date(v.valid_until).getTime() <= nowMs) return { key: 'expired', actionable: false };
    return { key: w.quote.status, actionable: w.quote.status === 'sent' };
  };

  const quoteCard = (v: QuoteVersionRow, id: string) => {
    const st = statusOf(v);
    const lines = w.items.filter((i) => i.quote_version_id === v.id);
    return (
      <article key={id} className="qcard" aria-label={`${d('quoteCard')} ${v.version_number}`} data-quote-status={st.key}>
        <header className="qcard-head">
          <strong>{d('quoteCard')} · {d('quoteVersion', { n: v.version_number })}</strong>
          <span className={`chip-x ${st.key === 'accepted' ? 'green' : st.key === 'sent' ? 'gold' : ''}`}>{st.key === 'outdated' ? d('qs_withdrawn') : d(`qs_${st.key}`)}</span>
        </header>
        <p className="mut qcard-sub">{d('quoteBy', { name: sellerName })} · {d('validUntil', { date: fmt.dateTime(new Date(v.valid_until), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }) })}</p>
        <p style={{ margin: '0 0 8px' }}>{v.scope_text}</p>
        <ul className="qcard-lines">{lines.map((i) => <li key={i.id}><span>{i.description} · {i.quantity} {i.unit} × {amount(i.unit_price)}</span><span>{v.currency} {amount(i.line_total)}</span></li>)}</ul>
        <p className="qcard-total"><span>{d('quoteTotal')}</span><strong>{v.currency} {amount(v.total)}</strong></p>
        <p className="mut" style={{ margin: 0 }}>{d('quoteDelivery')}: {v.delivery_timing}</p>
        <BookingTerms terms={v} headingLevel={4} />
        {v.terms_text ? <p className="mut" style={{ margin: '4px 0 0' }}>{d('quoteTerms')}: {v.terms_text}</p> : null}
        {v.exclusions ? <p className="mut" style={{ margin: '4px 0 0' }}>{d('quoteExclusions')}: {v.exclusions}</p> : null}
        {st.key === 'outdated' ? <p className="mut" style={{ margin: '6px 0 0' }}>{d('quoteOutdated')}</p> : null}
        {st.key === 'expired' ? <p className="mut" style={{ margin: '6px 0 0' }}>{d('quoteExpired')}</p> : null}
        {side === 'buyer' && st.actionable && w.quote ? (
          <div className="qcard-actions">
            <p className="mut" style={{ margin: 0 }}>{d('acceptNote')}</p>
            {(['accept', 'decline'] as const).map((decision) => (
              <ActionForm key={decision} action={respondQuoteAction} submitLabel={d(decision)} variant={decision === 'decline' ? 'secondary' : 'primary'}>
                <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote!.id} />
                <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="expectedVersion" value={w.quote!.version} />
                <input type="hidden" name="decision" value={decision} />
              </ActionForm>
            ))}
            <details>
              <summary className="btn btn-secondary">{d('requestChanges')}</summary>
              <ActionForm action={respondQuoteAction} submitLabel={d('requestChanges')} variant="secondary">
                <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote.id} />
                <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="expectedVersion" value={w.quote.version} />
                <input type="hidden" name="decision" value="request_revision" />
                <label htmlFor="revision-reason">{d('changeReason')}</label>
                <textarea id="revision-reason" name="reason" minLength={3} maxLength={1000} required />
              </ActionForm>
            </details>
          </div>
        ) : null}
        {side === 'seller' && st.key === 'sent' && w.quote ? (
          <div className="qcard-actions">
            <ActionForm action={withdrawQuoteAction} submitLabel={d('withdraw')} variant="secondary">
              <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote.id} /><input type="hidden" name="expectedVersion" value={w.quote.version} />
            </ActionForm>
          </div>
        ) : null}
      </article>
    );
  };

  const canEditQuote = side === 'seller' && (!w.quote || ['draft', 'revision_requested'].includes(w.quote.status));
  const editor = (
    <>
      <ActionForm action={saveQuoteAction} submitLabel={t('saveDraft')} variant="secondary">
        <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="expectedVersion" value={w.quote?.version ?? 0} />
        <div className="field"><label htmlFor="scope">{t('scope')}</label><textarea id="scope" name="scope" minLength={3} maxLength={2000} required defaultValue={field(draft?.scope)} /></div>
        {[1, 2, 3, 4, 5].map((n) => {
          const line = draftLines[n - 1] ?? {};
          return <fieldset key={n}><legend>{t('description')} {n}</legend>
            <div className="field"><label htmlFor={`description${n}`}>{t('description')}</label><input id={`description${n}`} name={`description${n}`} maxLength={500} required={n === 1} defaultValue={field(line.description)} /></div>
            <div className="field"><label htmlFor={`quantity${n}`}>{t('quantity')}</label><input id={`quantity${n}`} name={`quantity${n}`} inputMode="decimal" required={n === 1} defaultValue={field(line.quantity)} /></div>
            <div className="field"><label htmlFor={`unit${n}`}>{t('unit')}</label><input id={`unit${n}`} name={`unit${n}`} maxLength={40} required={n === 1} defaultValue={field(line.unit)} /></div>
            <div className="field"><label htmlFor={`unitPrice${n}`}>{t('unitPrice')}</label><input id={`unitPrice${n}`} name={`unitPrice${n}`} inputMode="decimal" required={n === 1} defaultValue={field(line.unit_price)} /></div>
          </fieldset>;
        })}
        <div className="field"><label htmlFor="deliveryFee">{t('deliveryFee')}</label><input id="deliveryFee" name="deliveryFee" inputMode="decimal" defaultValue={field(draft?.delivery_fee) || '0'} /></div>
        <div className="field"><label htmlFor="taxAmount">{t('taxAmount')}</label><input id="taxAmount" name="taxAmount" inputMode="decimal" defaultValue={field(draft?.tax_amount) || '0'} /></div>
        <div className="field"><label htmlFor="taxTreatment">{t('taxTreatment')}</label><input id="taxTreatment" name="taxTreatment" minLength={3} maxLength={500} required defaultValue={field(draft?.tax_treatment)} /></div>
        <div className="field"><label htmlFor="deliveryTiming">{t('deliveryTiming')}</label><input id="deliveryTiming" name="deliveryTiming" minLength={3} maxLength={500} required defaultValue={field(draft?.delivery_timing)} /></div>
        <div className="field"><label htmlFor="validUntil">{t('validUntil')}</label><input id="validUntil" type="date" name="validUntil" required defaultValue={field(draft?.valid_until).slice(0, 10)} /></div>
        <fieldset className="booking-fields">
          <legend>{d('termsTitle')}</legend>
          <p className="mut">{d('termsHelp')}</p>
          <div className="field"><label htmlFor="bookingDate">{d('bookingDate')}</label><input id="bookingDate" type="date" name="bookingDate" required defaultValue={field(draft?.booking_date)} /></div>
          <div className="field"><label htmlFor="completionBy">{d('completionBy')}</label><input id="completionBy" type="date" name="completionBy" defaultValue={field(draft?.completion_by)} /></div>
          <div className="field"><label htmlFor="depositTerms">{d('depositTerms')}</label><textarea id="depositTerms" name="depositTerms" minLength={3} maxLength={500} required defaultValue={field(draft?.deposit_terms)} /><small className="mut">{d('depositHint')}</small></div>
          <div className="field"><label htmlFor="cancellationOption">{d('cancellation')}</label>
            <select id="cancellationOption" name="cancellationOption" required defaultValue={field(draft?.cancellation_option)}>
              <option value="" disabled>{d('cancellationChoose')}</option>
              {CANCELLATION_OPTIONS.map((o) => <option key={o} value={o}>{d(`canc_${o}`)}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="cancellationText">{d('cancellationText')}</label><textarea id="cancellationText" name="cancellationText" maxLength={500} defaultValue={field(draft?.cancellation_text)} /></div>
        </fieldset>
        <div className="field"><label htmlFor="terms">{t('terms')}</label><textarea id="terms" name="terms" maxLength={2000} defaultValue={field(draft?.terms)} /></div>
        <div className="field"><label htmlFor="exclusions">{t('exclusions')}</label><textarea id="exclusions" name="exclusions" maxLength={2000} defaultValue={field(draft?.exclusions)} /></div>
      </ActionForm>
      {draft && w.quote ? (
        <div className="qcard" style={{ marginTop: 12 }}>
          <strong>{d('previewTitle')}</strong>
          <p className="mut" style={{ margin: '4px 0' }}>{d('previewNote')}</p>
          <p style={{ margin: '0 0 6px' }}>{field(draft.scope)}</p>
          <p className="qcard-total"><span>{d('quoteTotal')}</span><strong>MYR {preview ?? '—'}</strong></p>
          <BookingTerms headingLevel={4} terms={{ booking_date: field(draft.booking_date) || null, completion_by: field(draft.completion_by) || null, deposit_terms: field(draft.deposit_terms) || null,
            cancellation_option: field(draft.cancellation_option) || null, cancellation_text: field(draft.cancellation_text) || null }} />
          {draft.booking_date ? null : <p className="message message-error" role="note">{d('termsMissing')}</p>}
          <ActionForm action={sendQuoteAction} submitLabel={t('sendQuote')}>
            <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="quotationId" value={w.quote.id} />
            <input type="hidden" name="expectedVersion" value={w.quote.version} />
          </ActionForm>
        </div>
      ) : null}
    </>
  );

  return (
    <section aria-labelledby="conversation-title" className="conv">
      <h2 id="conversation-title" className="sr">{t('conversation')}</h2>
      <div className="msg-body" data-testid="conversation">
        {w.hasEarlier && w.messages[0] ? (
          <p className="deal-earlier"><Link href={`/enquiries/${enquiryId}?before=${encodeURIComponent(w.messages[0].created_at)}`} className="btn btn-secondary btn-sm">{d('earlier')}</Link></p>
        ) : null}
        {items.length === 0 ? <p className="mut">{d('noMessages')}</p> : null}
        {items.map((it) => {
          if (it.kind === 'msg') {
            const mine = it.fromBuyer === (side === 'buyer');
            return <div key={it.id} className={mine ? 'bub me' : 'bub them'}>
              {it.body}
              <time className="bub-meta" dateTime={it.at}>{it.fromBuyer ? tc('buyer') : tc('seller')} · {formatMyt(it.at, locale)}</time>
            </div>;
          }
          if (it.kind === 'quote') return quoteCard(it.version, it.id);
          return <p key={it.id} className="deal-event" data-event={it.event}>
            <span>{d(`ev_${it.event.replace('.', '_')}`)}{it.note ? ` · ${noteText(it.note)}` : ''}</span>
            <time dateTime={it.at}>{formatMyt(it.at, locale)}</time>
            {it.event === 'order.created' && it.orderId ? <Link href={`/orders/${it.orderId}`} className="btn btn-secondary btn-sm">{d('viewOrder')}</Link> : null}
          </p>;
        })}
      </div>
      <div className="msg-composer">
        <ActionForm action={messageAction} submitLabel={d('send')}>
          <input type="hidden" name="enquiryId" value={enquiryId} /><input type="hidden" name="key" value={randomUUID()} />
          <label htmlFor="reply-body">{d('composerLabel')}</label><textarea id="reply-body" name="body" maxLength={4000} required rows={2} />
        </ActionForm>
        {canEditQuote ? (
          <p style={{ margin: '8px 0 0' }}>
            <QuoteDialog buttonLabel={draft ? d('editQuote') : d('createQuote')} title={d('quoteEditorTitle')} hint={d('quoteEditorHint')} closeLabel={d('close')}>{editor}</QuoteDialog>
          </p>
        ) : null}
      </div>
    </section>
  );
}
