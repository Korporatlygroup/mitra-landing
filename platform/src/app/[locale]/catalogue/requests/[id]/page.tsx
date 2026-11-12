import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { PriceTiers } from '@/components/catalogue/Notes';
import QuickForm from '@/components/catalogue/QuickForm';
import { TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { formatDate, intlLocale } from '@/lib/p5-format';
import { uuidSchema } from '@/lib/schemas';
import { getSourcingRequest } from '@/server/services/p5-buyer';
import { requireSession } from '@/server/session';
import { priceText } from '@/components/catalogue/helpers';
import { replyRequestAction, withdrawRequestAction } from '../../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'p5buyer.requests' });
  return { title: t('detailTitle') };
}

const tone = (s: string) => (s === 'acknowledged' ? 'approved' : s === 'withdrawn' || s === 'closed' ? 'rejected' : s === 'clarification_requested' ? 'needs_info' : 'none');

/** One price request: the terms as they were shown when it was sent (a snapshot), the history, and what the buyer can still do. */
export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const session = await requireSession({ locale, path: `/catalogue/requests/${id}` });
  if (!uuidSchema.safeParse(id).success) notFound();
  const r = await getSourcingRequest(session.supabase, id);
  if (!r.ok || r.data.your_side !== 'buyer') notFound();
  const d = r.data;
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const stamp = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  const open = d.status === 'submitted' || d.status === 'acknowledged' || d.status === 'clarification_requested';
  const flag = (k: string) => sp[k] === '1';

  return (
    <>
      <p>
        <Link href="/catalogue/requests" locale={locale}>
          {t('requests.back')}
        </Link>
      </p>
      {flag('sent') ? (
        <div className="message message-ok" role="status" data-testid="request-sent">
          <strong>{t('requests.sentTitle')}</strong> {t('requests.sentBody', { reference: d.reference })}
        </div>
      ) : null}
      {flag('replied') ? (
        <p className="message message-ok" role="status">
          {t('requests.repliedBody')}
        </p>
      ) : null}
      {flag('withdrawn') ? (
        <p className="message message-ok" role="status">
          {t('requests.withdrawnBody')}
        </p>
      ) : null}

      <h1>
        {t('requests.reference')}: <span data-testid="request-reference">{d.reference}</span>
      </h1>
      <p>
        <StatusChip status={tone(d.status)} label={tc(`status.sourcing.${d.status}`)} />
      </p>
      <p className="muted">{t('requests.statusHelp.' + d.status)}</p>

      <dl className="dl">
        <dt>{tc('labels.supplier')}</dt>
        <dd>{d.supplier_name ?? t('requests.supplierGone')}</dd>
        <dt>{t('requests.sentLabel')}</dt>
        <dd>{formatDate(d.created_at, locale)}</dd>
        <dt>{t('requests.deliverTo')}</dt>
        <dd>{[d.destination_city, d.destination_state].filter(Boolean).join(', ') || t('detail.notProvided')}</dd>
        <dt>{t('requests.neededBy')}</dt>
        <dd>{d.needed_by ? formatDate(d.needed_by, locale) : t('detail.notProvided')}</dd>
        <dt>{t('requests.yourNotes')}</dt>
        <dd style={{ whiteSpace: 'pre-line' }}>{d.notes || t('detail.notProvided')}</dd>
      </dl>

      <section aria-labelledby="items-h">
        <h2 id="items-h">{t('requests.itemsTitle')}</h2>
        <p className="muted">{t('requests.snapshotNote')}</p>
        <ul className="card-list">
          {d.items.map((it) => {
            const s = it.snapshot;
            return (
              <li key={it.line_no} className="card">
                <h3 style={{ marginTop: 0 }}>{s.name}</h3>
                {!it.still_available ? <p className="chip chip-bad">{t('requests.noLongerShown')}</p> : null}
                <dl className="dl">
                  <dt>{tc('labels.sku')}</dt>
                  <dd>{s.sku}</dd>
                  {s.variant ? (
                    <>
                      <dt>{t('requests.variant')}</dt>
                      <dd>
                        {s.variant.label} ({s.variant.sku})
                      </dd>
                    </>
                  ) : null}
                  <dt>{t('requests.quantity')}</dt>
                  <dd>
                    {it.quantity} {tc(`units.${it.unit}`)}
                  </dd>
                  <dt>{tc('labels.moq')}</dt>
                  <dd>
                    {s.moq} {tc(`units.${it.unit}`)}
                  </dd>
                  <dt>{t('requests.priceThen')}</dt>
                  <dd>
                    {s.price_mode === 'request' || s.applicable_unit_price == null
                      ? tc('price.onRequest')
                      : `${priceText(s.applicable_unit_price, s.currency, locale)} ${t('card.perUnit', { unit: tc(`units.${it.unit}`) })}`}
                    <br />
                    <span className="muted">{t('card.indicative')}</span>
                  </dd>
                  <dt>{t('requests.currency')}</dt>
                  <dd>{tc(`currencies.${s.currency}`)}</dd>
                  {s.price_confirmed_on ? (
                    <>
                      <dt>{t('requests.priceDate')}</dt>
                      <dd>{formatDate(s.price_confirmed_on, locale)}</dd>
                    </>
                  ) : null}
                  {s.availability_confirmed_on ? (
                    <>
                      <dt>{t('requests.availDate')}</dt>
                      <dd>{formatDate(s.availability_confirmed_on, locale)}</dd>
                    </>
                  ) : null}
                </dl>
                {s.tiers && s.tiers.length > 0 ? (
                  <details>
                    <summary>{t('requests.tiersShown')}</summary>
                    <PriceTiers tiers={s.tiers} currency={s.currency} unit={it.unit} locale={locale} />
                  </details>
                ) : null}
                {it.product_id && it.still_available ? (
                  <p>
                    <Link href={`/catalogue/${it.product_id}`} locale={locale}>
                      {t('requests.openProduct')}
                    </Link>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="ev-h">
        <h2 id="ev-h">{t('requests.historyTitle')}</h2>
        <ol className="timeline">
          {d.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <strong>{t(`requests.events.${e.kind}`)}</strong>{' '}
              <span className="muted">
                {e.by === 'buyer' ? t('requests.byYou') : t('requests.bySupplierSide')} · <time dateTime={e.at}>{stamp.format(new Date(e.at))}</time>
              </span>
              {e.note ? <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{e.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      {d.status === 'clarification_requested' ? (
        <section aria-labelledby="reply-h">
          <h2 id="reply-h">{t('requests.replyTitle')}</h2>
          <ActionForm action={replyRequestAction} submitLabel={t('requests.replySend')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="requestId" value={d.id} />
            <TextArea id="note" name="note" label={t('requests.replyLabel')} hint={t('requests.replyHint')} required maxLength={1000} />
          </ActionForm>
        </section>
      ) : null}

      {open ? (
        <section aria-labelledby="wd-h">
          <h2 id="wd-h">{t('requests.withdrawTitle')}</h2>
          <details>
            <summary>{t('requests.withdrawOpen')}</summary>
            <p>{t('requests.withdrawBody')}</p>
            <QuickForm action={withdrawRequestAction} fields={{ locale, requestId: d.id }} label={t('requests.withdrawConfirm')} variant="danger" />
          </details>
        </section>
      ) : null}
    </>
  );
}
