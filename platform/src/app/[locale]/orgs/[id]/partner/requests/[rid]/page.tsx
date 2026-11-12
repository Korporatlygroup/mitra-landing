import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerForm from '@/components/partner/PartnerForm';
import PartnerGate from '@/components/partner/PartnerGate';
import { TextAreaInput } from '@/components/partner/fields';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { formatDate, formatMoney } from '@/lib/p5-format';
import { statusTone } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { markNotificationRead } from '@/server/services/verification';
import { getPartnerRequest } from '@/server/services/p5-partner';
import { respondRequestAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.requests.detailTitle');
}

const KNOWN_EVENTS = new Set(['submitted', 'acknowledged', 'clarification_requested', 'buyer_replied', 'withdrawn', 'closed']);

export default async function RequestDetailPage({ params }: { params: Promise<{ locale: string; id: string; rid: string }> }) {
  const { locale, id, rid } = await params;
  if (!uuidSchema.safeParse(rid).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/requests/${rid}`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const db = ctx.session.supabase;
  const r = await getPartnerRequest(db, rid);
  if (!r.ok || r.data.your_side !== 'partner' || r.data.partner_org_id !== id) notFound();
  const q = r.data;

  // Opening the request marks its notifications as read (they are this user's own).
  const { data: unread } = await db.from('notifications').select('id').eq('entity_type', 'sourcing_request').eq('entity_id', rid).is('read_at', null);
  for (const n of (unread ?? []) as { id: string }[]) await markNotificationRead(db, n.id);

  const [t, tc, tt, fmt] = await Promise.all([
    getTranslations({ locale, namespace: 'p5partner.requests' }),
    getTranslations({ locale, namespace: 'p5common' }),
    getTranslations({ locale, namespace: 'p5partner.common' }),
    getFormatter({ locale }),
  ]);
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  const open = q.status === 'submitted';
  const base = `/orgs/${id}/partner/requests`;

  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <h1>{q.reference}</h1>
      <p>
        <StatusChip status={statusTone(q.status === 'submitted' ? 'previewed' : q.status)} label={q.status === 'submitted' ? t('statusNew') : tc(`status.sourcing.${q.status}`)} />
      </p>
      <p className="next-step" data-testid="status-explain">
        {t(`explain.${q.status}`)}
      </p>

      <h2>{t('requestTitle')}</h2>
      <dl className="dl">
        <dt>{t('buyer')}</dt>
        <dd>{q.buyer_name ?? t('buyerHidden')}</dd>
        <dt>{tc('labels.supplier')}</dt>
        <dd>{q.supplier_name ?? '-'}</dd>
        <dt>{t('destination')}</dt>
        <dd>{[q.destination_city, q.destination_state].filter(Boolean).join(', ') || '-'}</dd>
        <dt>{t('neededByLabel')}</dt>
        <dd>{q.needed_by ? formatDate(q.needed_by, locale) : t('notSaid')}</dd>
        <dt>{t('sentOn')}</dt>
        <dd>{when(q.created_at)}</dd>
        <dt>{t('notes')}</dt>
        <dd style={{ whiteSpace: 'pre-line' }}>{q.notes || t('noNotes')}</dd>
      </dl>
      <p className="hint">{t('privacyNote')}</p>

      <h2>{t('itemsTitle')}</h2>
      <p className="hint">{t('snapshotNote')}</p>
      <ul className="card-list" data-testid="request-items">
        {q.items.map((it) => {
          const s = it.snapshot;
          const cur = s.currency;
          return (
            <li key={it.line_no} className="card" data-testid="request-item">
              <h3 style={{ margin: '0 0 4px' }}>
                {s.name} <span className="muted">({s.sku})</span>
              </h3>
              <dl className="dl">
                <dt>{t('quantity')}</dt>
                <dd data-testid="item-quantity">
                  {it.quantity} {s.unit ? tc(`units.${s.unit}` as never) : ''}
                </dd>
                {s.variant ? (
                  <>
                    <dt>{t('variant')}</dt>
                    <dd>
                      {s.variant.label} ({s.variant.sku})
                    </dd>
                  </>
                ) : null}
                <dt>{tc('labels.moq')}</dt>
                <dd>{s.moq}</dd>
                <dt>{t('priceShown')}</dt>
                <dd data-testid="item-price">
                  {s.price_mode === 'request' ? tc('price.onRequest') : s.applicable_unit_price != null ? formatMoney(s.applicable_unit_price, cur, locale) : '-'}{' '}
                  <span className="muted">({tc(`price.${s.price_mode}`)})</span>
                </dd>
                {s.price_confirmed_on ? (
                  <>
                    <dt>{t('priceDate')}</dt>
                    <dd>{formatDate(s.price_confirmed_on, locale)}</dd>
                  </>
                ) : null}
                {s.availability_confirmed_on ? (
                  <>
                    <dt>{t('availabilityDate')}</dt>
                    <dd>{formatDate(s.availability_confirmed_on, locale)}</dd>
                  </>
                ) : null}
              </dl>
              {s.tiers && s.tiers.length > 0 ? (
                <div className="table-wrap">
                  <table className="stack">
                    <caption className="visually-hidden">{t('tiersShown')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t('tierQuantity')}</th>
                        <th scope="col">{t('tierPrice')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.tiers.map((tr, i) => (
                        <tr key={i}>
                          <td data-label={t('tierQuantity')}>{tr.max_qty == null ? t('orMore', { min: tr.min_qty }) : t('range', { min: tr.min_qty, max: tr.max_qty })}</td>
                          <td data-label={t('tierPrice')}>{formatMoney(tr.unit_price, cur, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {!it.still_available ? <p className="hint">{t('noLongerListed')}</p> : null}
            </li>
          );
        })}
      </ul>

      <h2>{t('historyTitle')}</h2>
      <ol className="timeline" data-testid="request-events">
        {q.events.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <strong>{t(`events.${KNOWN_EVENTS.has(e.kind) ? e.kind : 'other'}`)}</strong>
            <span className="muted"> &middot; {when(e.at)}</span>
            {e.note ? (
              <p style={{ margin: '2px 0 0', whiteSpace: 'pre-line' }} data-testid="event-note">
                {e.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {open && ctx.canRespond ? (
        <section aria-labelledby="respond-h">
          <h2 id="respond-h">{t('respondTitle')}</h2>
          <p>{t('respondBody')}</p>
          <PartnerForm
            action={respondRequestAction}
            submitLabel={t('acknowledge')}
            extra={[{ label: t('askClarification'), value: 'clarify' }]}
            reloadHref={`/${locale}${base}/${rid}`}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={id} />
            <input type="hidden" name="requestId" value={rid} />
            <input type="hidden" name="expectedVersion" value={q.version} />
            <TextAreaInput id="note" name="note" label={t('noteLabel')} hint={t('noteHint')} maxLength={1000} rows={4} />
          </PartnerForm>
        </section>
      ) : null}
      {open && !ctx.canRespond ? <p className="message message-error">{t('cannotRespond')}</p> : null}
    </>
  );
}
