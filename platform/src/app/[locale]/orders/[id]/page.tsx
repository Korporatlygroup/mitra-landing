import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import BookingTerms from '@/components/deals/BookingTerms';
import StatusBadge from '@/components/shared/StatusBadge';
import { Link } from '@/i18n/navigation';
import { decodeIssueNote, ISSUE_REASONS } from '@/lib/issue-note';
import { pageTitle } from '@/lib/metadata';
import { uuidSchema } from '@/lib/schemas';
import { formatMyt } from '@/lib/time';
import { getEnquiryParties } from '@/server/services/directory';
import { getOrder, listDealEvents, type OrderAction } from '@/server/services/deals';
import { requireSession } from '@/server/session';
import { orderActionAction, orderDetailsAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'deals.ordersTitle');
}

/** One agreement: what was accepted (an exact quotation version), its status and history, and the few actions allowed to each side. */
export default async function OrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const s = await requireSession({ locale, requireOrg: true, path: `/orders/${id}`, requireMfaIfNeeded: false });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const fmt = await getFormatter({ locale });
  const o = await getOrder(s.supabase, id);
  if (!o) notFound();
  const parties = await getEnquiryParties(s.supabase, o.enquiry_id);
  if (!parties.ok) notFound();
  const side = parties.data.you_are;
  const events = (await listDealEvents(s.supabase, o.enquiry_id)).filter((e) => e.order_id === o.id);
  const money = (v: string) => { const [w, f = ''] = String(v).split('.'); return `${w}.${f.padEnd(2, '0')}`; };
  const noteText = (n: string) => { const x = decodeIssueNote(n); return x.reason ? `${d(`ir_${x.reason}`)}: ${x.details}` : n; };
  const tone = o.status === 'completed' ? 'green' : o.status === 'disputed' ? 'red' : o.status === 'cancelled' ? 'neutral' : 'gold';
  const mine: { action: OrderAction; note?: 'required' | 'optional' }[] = [];
  if (side === 'seller' && o.status === 'agreed') mine.push({ action: 'start' });
  if (side === 'seller' && o.status === 'in_progress') mine.push({ action: 'mark_delivered', note: 'required' });
  if (side === 'buyer' && o.status === 'buyer_confirmation_pending') mine.push({ action: 'confirm' });
  if (side === 'buyer' && ['in_progress', 'buyer_confirmation_pending'].includes(o.status)) mine.push({ action: 'dispute', note: 'required' });
  if (o.status === 'agreed') mine.push({ action: 'cancel', note: 'optional' });

  return (
    <div className="wide deal-order">
      <p><Link href="/orders" className="btn btn-secondary btn-sm">← {d('tabOrders')}</Link></p>
      <h1>{d('orderTitle', { ref: o.reference })}</h1>
      <p>
        <StatusBadge label={d(`os_${o.status}`)} tone={tone} />{' '}
        <Link href={`/enquiries/${o.enquiry_id}`} className="btn btn-secondary btn-sm">{d('openConversation')}</Link>
      </p>
      <p className="banner">{d('paymentNote')}</p>
      <section className="card" aria-labelledby="o-sum">
        <h2 id="o-sum">{d('agreedItems')}</h2>
        <dl className="dl">
          <dt>{d('buyer')}</dt><dd>{parties.data.buyer_name ?? '-'}</dd>
          <dt>{d('seller')}</dt><dd>{parties.data.seller_name}</dd>
          <dt>{d('orderDelivery')}</dt><dd>{o.delivery_timing}</dd>
          {o.terms_locked ? null : <><dt>{d('serviceDate')}</dt><dd>{o.service_date ? fmt.dateTime(new Date(`${o.service_date}T00:00:00+08:00`), { dateStyle: 'long', timeZone: 'Asia/Kuala_Lumpur' }) : '-'}</dd></>}
          {o.deposit_note && !o.terms_locked ? <><dt>{d('deposit')}</dt><dd>{o.deposit_note}</dd></> : null}
        </dl>
        {o.terms_locked ? (
          <>
            <BookingTerms title={d('acceptedTerms')} terms={{ booking_date: o.service_date, completion_by: o.completion_by, deposit_terms: o.deposit_note, cancellation_option: o.cancellation_option, cancellation_text: o.cancellation_text }} />
            <p className="mut">{d('termsChange')}</p>
          </>
        ) : null}
        <p>{o.scope_text}</p>
        <ul className="qcard-lines">{o.items.map((i, n) => <li key={n}><span>{i.description} · {i.quantity} {i.unit} × {money(i.unit_price)}</span><span>{o.currency} {money(i.line_total)}</span></li>)}</ul>
        <p className="qcard-total"><span>{d('agreedTotal')}</span><strong>{o.currency} {money(o.total)}</strong></p>
        {o.terms_text || o.exclusions ? <><h3>{d('orderTerms')}</h3>{o.terms_text ? <p>{o.terms_text}</p> : null}{o.exclusions ? <p className="mut">{d('quoteExclusions')}: {o.exclusions}</p> : null}</> : null}
        <p className="mut">{d('notPromise')}</p>
      </section>

      {side === 'seller' && o.status === 'agreed' && !o.terms_locked ? (
        <section className="card">
          <h2>{d('serviceDate')}</h2>
          <ActionForm action={orderDetailsAction} submitLabel={d('saveDetails')} variant="secondary">
            <input type="hidden" name="orderId" value={o.id} />
            <div className="field"><label htmlFor="serviceDate">{d('serviceDate')}</label><input id="serviceDate" name="serviceDate" type="date" defaultValue={o.service_date ?? ''} /></div>
            <div className="field"><label htmlFor="deposit">{d('deposit')}</label><textarea id="deposit" name="deposit" maxLength={500} defaultValue={o.deposit_note ?? ''} /></div>
          </ActionForm>
        </section>
      ) : null}

      {mine.length ? (
        <section className="card deal-actions" aria-label={d('orderStatus')}>
          {mine.map((m) => (
            <ActionForm key={m.action} action={orderActionAction} submitLabel={d(`act_${m.action}`)} variant={m.action === 'dispute' || m.action === 'cancel' ? 'secondary' : 'primary'}>
              <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="action" value={m.action} />
              {m.action === 'dispute' ? (
                <>
                  <p className="mut">{d('issueHelp')}</p>
                  <div className="field">
                    <label htmlFor="issue-reason">{d('issueReason')}</label>
                    <select id="issue-reason" name="reason" required defaultValue="">
                      <option value="" disabled>{d('issueReasonChoose')}</option>
                      {ISSUE_REASONS.map((r) => <option key={r} value={r}>{d(`ir_${r}`)}</option>)}
                    </select>
                  </div>
                </>
              ) : null}
              {m.note ? (
                <div className="field">
                  <label htmlFor={`note-${m.action}`}>{m.action === 'mark_delivered' ? d('evidence') : m.action === 'dispute' ? d('issueNote') : d('cancelNote')}</label>
                  <textarea id={`note-${m.action}`} name="note" maxLength={2000} required={m.note === 'required'} />
                </div>
              ) : null}
            </ActionForm>
          ))}
        </section>
      ) : null}

      <section className="card" aria-labelledby="o-act">
        <h2 id="o-act">{d('activity')}</h2>
        <ol className="deal-timeline">
          {events.map((e) => (
            <li key={e.id}><strong>{d(`ev_${e.kind.replace('.', '_')}`)}</strong>{e.note ? <span> · {noteText(e.note)}</span> : null}<time className="mut" dateTime={e.created_at}> · {formatMyt(e.created_at, locale)}</time></li>
          ))}
        </ol>
      </section>
      <p className="mut"><Link href="/complaints" locale={locale}>{d('reportLink')}</Link></p>
    </div>
  );
}
