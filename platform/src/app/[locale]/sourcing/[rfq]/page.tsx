import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import OfferForm from '@/components/sourcing/OfferForm';
import DocumentUploadForm from '@/components/sourcing/DocumentUploadForm';
import { Link } from '@/i18n/navigation';
import {
  changeSourcingStatusAction, proposeSourcingCounterAction, requestSourcingSampleAction,
  respondSourcingCounterAction, respondSourcingInvitationAction,
  saveSourcingTemplateAction, selectSourcingQuoteAction, sendSourcingMessageAction, updateSourcingSampleAction,
} from '../actions';
import { listMySuppliers } from '@/server/services/p5-partner';
import { getSourcingRfq, getSourcingTimeline, listSourcingCounters, listSourcingDocuments, listSourcingPartners, matchSourcingRfq } from '@/server/services/p6-sourcing';
import { requireSession } from '@/server/session';

const money = (value: string | number) => {
  const [whole, fraction = ''] = String(value).split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
};

export default async function SourcingDetailPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string; rfq: string }>;
  searchParams: Promise<{ partner?: string }>;
}) {
  const { locale, rfq } = await params;
  const partner = (await searchParams).partner ?? null;
  const session = await requireSession({ locale, path: `/sourcing/${rfq}` });
  const t = await getTranslations({ locale, namespace: 'p6' });
  const [result, counterResult, timelineResult, partnerResult, matchResult] = await Promise.all([
    getSourcingRfq(session.supabase, rfq, partner), listSourcingCounters(session.supabase, rfq, partner),
    getSourcingTimeline(session.supabase, rfq, partner), listSourcingPartners(session.supabase),
    matchSourcingRfq(session.supabase, rfq, partner),
  ]);
  if (!result.ok) notFound();
  const r = result.data;
  const buyer = Boolean(r.buyer_org_id);
  const partnerId = buyer ? null : r.partner_org_id;
  const partners = partnerResult.ok ? partnerResult.data : [];
  const partnerName = (id: string) => partners.find((p) => p.id === id)?.name ?? t('partners');
  const myOffers = r.quotes.filter((q) => q.partner_org_id === partnerId);
  const supplierResult = partnerId ? await listMySuppliers(session.supabase, partnerId) : null;
  const suppliers = supplierResult?.ok ? supplierResult.data.items.filter((s) => s.status === 'approved')
    .map((s) => ({ id: s.id, name: s.name ?? s.code })) : [];
  const canAct = !['closed', 'cancelled', 'preferred_selected'].includes(r.status);
  const canRespond = canAct && (!partnerId || r.your_invitation_status === 'accepted');
  const threads = buyer ? (r.partners ?? []).map((p) => p.org_id) : partnerId ? [partnerId] : [];
  const documentLists = await Promise.all(threads.map((id) => listSourcingDocuments(session.supabase, rfq, id)));
  const documents = new Map(threads.map((id, index) => [id, documentLists[index]?.ok ? documentLists[index].data : []]));
  const counters = counterResult.ok ? counterResult.data : [];
  const timeline = timelineResult.ok ? timelineResult.data : [];
  const itemTemplate = JSON.stringify(r.items.map((i) => ({
    name: i.name, quantity: String(i.quantity), unit: i.unit, category_slug: i.category_slug ?? undefined,
    specification: i.specification ?? '',
  })));
  return <div className="container">
    <nav className="link-row" aria-label={t('title')}>
      <Link href={buyer ? '/sourcing' : `/orgs/${partnerId}/partner/sourcing`} locale={locale} className="btn btn-secondary">
        {buyer ? t('myRequests') : t('partnerRequests')}
      </Link>
    </nav>
    <h1>{t('request')} {r.reference}</h1>
    <p>{t(`status.${r.status as 'submitted'}`)} · {r.destination_state}{r.destination_city ? `, ${r.destination_city}` : ''}</p>
    {partnerId && r.your_invitation_status === 'invited' && canAct ?
      <div className="link-row">{(['accept','decline'] as const).map((decision) =>
        <ActionForm key={decision} action={respondSourcingInvitationAction} submitLabel={t(decision)}>
          <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
          <input type="hidden" name="partner" value={partnerId} /><input type="hidden" name="decision" value={decision} />
        </ActionForm>)}</div> : null}
    {buyer && (canAct || r.status === 'preferred_selected') ?
      <ActionForm action={changeSourcingStatusAction}
        submitLabel={r.status === 'preferred_selected' ? t('close') : t('cancel')}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
        <input type="hidden" name="version" value={r.version} />
        <input type="hidden" name="action" value={r.status === 'preferred_selected' ? 'close' : 'cancel'} />
      </ActionForm> : null}
    <section className="card">
      <h2>{t('items')}</h2>
      <ul>{r.items.map((item) => <li key={item.id}>
        <strong>{item.name}</strong> — {item.quantity} {item.unit}
        {item.specification ? <p>{item.specification}</p> : null}
      </li>)}</ul>
      {r.note ? <p>{r.note}</p> : null}
    </section>
    {matchResult.ok && matchResult.data.length ? <section className="card"><h2>{t('matches')}</h2>
      <p>{t('matchNote')}</p>
      <ul>{matchResult.data.map((match) => <li key={`${match.item_id}-${match.product_id}`}>
        <strong>{match.name}</strong> · {partnerName(match.partner_org_id)} · {t('quantity')} ≥ {match.moq} {match.unit}
        <p>{t('matchUnknown')}</p>
      </li>)}</ul>
    </section> : null}
    <section>
      <h2>{t('offers')}</h2>
      {!r.quotes.length ? <p>{t('noOffers')}</p> : <div className="card-list">{r.quotes.map((quote) =>
        <article className="card" key={quote.id}>
          <h3>{partnerName(quote.partner_org_id)}</h3>
          <p><strong>{quote.offer.currency} {money(quote.offer.total)}</strong> · {t('validTo')} {quote.offer.valid_until}</p>
          <ul>{quote.offer.lines.map((line) => <li key={line.item_id}>
            {line.name}: {line.quantity} × {quote.offer.currency} {money(line.unit_price)} = {money(line.amount)}
          </li>)}</ul>
          <p>{t('charges')}: {money(quote.offer.charges)} · {t('discount')}: {money(quote.offer.discount)}</p>
          {quote.offer.terms ? <p>{quote.offer.terms}</p> : null}
          {buyer && canAct && quote.status === 'submitted' ? <>
            <ActionForm action={selectSourcingQuoteAction} submitLabel={t('choose')}>
              <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
              <input type="hidden" name="quote" value={quote.id} /><input type="hidden" name="version" value={r.version} />
            </ActionForm>
            <ActionForm action={proposeSourcingCounterAction} submitLabel={t('suggest')}>
              <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
              <input type="hidden" name="quote" value={quote.id} /><input type="hidden" name="version" value={r.version} />
              <div className="field"><label htmlFor={`counter-${quote.id}`}>{t('suggestPrice')} ({quote.offer.currency})</label>
                <input id={`counter-${quote.id}`} name="total" type="number" min="0" step="0.01" required /></div>
              <div className="field"><label htmlFor={`counter-note-${quote.id}`}>{t('note')}</label>
                <textarea id={`counter-note-${quote.id}`} name="note" maxLength={1000} required /></div>
            </ActionForm>
          </> : null}
        </article>)}</div>}
      {partnerId && canRespond ? <OfferForm locale={locale} rfq={rfq} partner={partnerId} items={r.items}
        offers={myOffers} suppliers={suppliers} /> : null}
    </section>
    {counters.length ? <section><h2>{t('counterOffers')}</h2><ul className="card-list">{counters.map((c) =>
      <li key={c.id} className="card"><strong>{c.currency} {c.proposed_total}</strong> · {c.status}<p>{c.note}</p>
        {partnerId && c.status === 'open' && canRespond ? <>
          {(['accept','decline'] as const).map((action) => <ActionForm key={action}
            action={respondSourcingCounterAction} submitLabel={t(action)}>
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
            <input type="hidden" name="counter" value={c.id} /><input type="hidden" name="action" value={action} />
          </ActionForm>)}
        </> : null}</li>)}</ul></section> : null}
    <section><h2>{t('messages')}</h2>{threads.map((thread) => <article className="card" key={thread}>
      <h3>{partnerName(thread)}</h3>
      <ol>{r.messages.filter((m) => m.partner_org_id === thread).map((m) =>
        <li key={m.id}><strong>{m.side === 'buyer' ? t('yourBusiness') : partnerName(thread)}:</strong> {m.body}</li>)}</ol>
      {canRespond ? <ActionForm action={sendSourcingMessageAction} submitLabel={t('sendMessage')}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
        <input type="hidden" name="partner" value={thread} />
        <div className="field"><label htmlFor={`message-${thread}`}>{t('message')}</label>
          <textarea id={`message-${thread}`} name="body" maxLength={2000} required /></div>
      </ActionForm> : null}
      {(r.partners ?? []).some((p) => p.org_id === thread && p.status === 'accepted')
        || (partnerId === thread && r.your_invitation_status === 'accepted') ? <div>
          <h4>{t('attachment')}</h4>
          <ul>{documents.get(thread)?.map((doc) => <li key={doc.id}>
            <a href={`/api/v1/sourcing/${rfq}/documents/${doc.id}`}>{doc.name}</a>
          </li>)}</ul>
          {canRespond ? <DocumentUploadForm rfq={rfq} partner={thread} /> : null}
        </div> : null}
    </article>)}</section>
    <section><h2>{t('sample')}</h2>
      {r.samples.map((sample) => <article className="card" key={sample.id}>
        <p>{r.items.find((item) => item.id === sample.item_id)?.name} · {sample.status}</p>
        {partnerId && canRespond && !['received','declined','cancelled'].includes(sample.status) ?
          <ActionForm action={updateSourcingSampleAction} submitLabel={t('update')}>
            <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
            <input type="hidden" name="sample" value={sample.id} /><input type="hidden" name="version" value={sample.version} />
            <div className="field"><label htmlFor={`sample-${sample.id}`}>{t('sampleStatus')}</label>
              <select id={`sample-${sample.id}`} name="status">
                {(sample.status === 'requested' ? ['accepted','declined'] :
                  sample.status === 'accepted' ? ['preparing'] :
                  sample.status === 'preparing' ? ['dispatched'] : ['received']).map((s) =>
                  <option key={s} value={s}>{s}</option>)}
              </select></div>
          </ActionForm> : null}
      </article>)}
      {buyer && canAct && threads.length ? <ActionForm action={requestSourcingSampleAction} submitLabel={t('requestSample')}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
        <div className="field"><label htmlFor="sample-partner">{t('partners')}</label>
          <select id="sample-partner" name="partner">{threads.map((id) =>
            <option key={id} value={id}>{partnerName(id)}</option>)}</select></div>
        <div className="field"><label htmlFor="sample-item">{t('product')}</label>
          <select id="sample-item" name="item">{r.items.map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="sample-note">{t('sampleNote')}</label>
          <textarea id="sample-note" name="note" maxLength={1000} /></div>
      </ActionForm> : null}
    </section>
    {buyer ? <section className="card"><h2>{t('repeat')}</h2>
      <Link href={`/sourcing/new?repeat=${rfq}`} locale={locale} className="btn btn-secondary">{t('repeat')}</Link>
      <ActionForm action={saveSourcingTemplateAction} submitLabel={t('saveTemplate')}>
        <input type="hidden" name="locale" value={locale} /><input type="hidden" name="rfq" value={rfq} />
        <input type="hidden" name="org" value={r.buyer_org_id!} /><input type="hidden" name="items" value={itemTemplate} />
        <div className="field"><label htmlFor="template-title">{t('templateTitle')}</label>
          <input id="template-title" name="title" required maxLength={100} /></div>
      </ActionForm>
    </section> : null}
    <section><h2>{t('timeline')}</h2><ol>{timeline.map((event, n) =>
      <li key={n}>{event.kind} · {event.at.slice(0, 10)}</li>)}</ol></section>
  </div>;
}
