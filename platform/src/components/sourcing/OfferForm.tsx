'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { submitSourcingQuoteAction } from '@/app/[locale]/sourcing/actions';
import ActionForm from '@/components/ActionForm';
import type { SourcingItem, SourcingOffer } from '@/server/services/p6-sourcing';

export default function OfferForm({ locale, rfq, partner, items, offers, suppliers = [] }: {
  locale: string; rfq: string; partner: string; items: SourcingItem[]; offers: SourcingOffer[];
  suppliers?: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('p6');
  const [supplier, setSupplier] = useState(offers[0]?.supplier_id ?? '');
  const previous = offers.find((offer) => (offer.supplier_id ?? '') === supplier);
  const [prices, setPrices] = useState<Record<string, string>>({});
  return <section className="card">
    <h2>{t('quote')}</h2>
    <div className="field"><label htmlFor="p6-supplier">{t('supplier')}</label>
      <select id="p6-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
        <option value="">{t('noSupplier')}</option>
        {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></div>
    <ActionForm key={supplier} action={submitSourcingQuoteAction}
      submitLabel={previous ? t('reviseQuote') : t('submitQuote')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="rfq" value={rfq} />
      <input type="hidden" name="partner" value={partner} />
      <input type="hidden" name="supplier" value={supplier} />
      <input type="hidden" name="expectedVersion" value={previous?.version ?? 0} />
      <input type="hidden" name="lines" value={JSON.stringify(items.map((item) => ({
        item_id: item.id, unit_price: prices[`${supplier}:${item.id}`] ??
          String(previous?.offer.lines.find((line) => line.item_id === item.id)?.unit_price ?? ''),
      })))} />
      {items.map((item) => <div className="field" key={item.id}>
        <label htmlFor={`price-${item.id}`}>{item.name}: {t('unitPrice')} ({item.quantity} {item.unit})</label>
        <input id={`price-${item.id}`} type="number" inputMode="decimal" step="0.01" min="0" required
          value={prices[`${supplier}:${item.id}`] ??
            String(previous?.offer.lines.find((line) => line.item_id === item.id)?.unit_price ?? '')}
          onChange={(e) => setPrices((prev) => ({ ...prev, [`${supplier}:${item.id}`]: e.target.value }))} />
      </div>)}
      <div className="field"><label htmlFor="p6-currency">{t('currency')}</label>
        <select id="p6-currency" name="currency" defaultValue={previous?.offer.currency ?? 'INR'}>
          <option value="INR">INR</option><option value="MYR">MYR</option><option value="USD">USD</option>
        </select></div>
      <div className="field"><label htmlFor="p6-charges">{t('charges')}</label>
        <input id="p6-charges" name="charges" type="number" min="0" step="0.01"
          defaultValue={previous?.offer.charges ?? '0.00'} required /></div>
      <div className="field"><label htmlFor="p6-discount">{t('discount')}</label>
        <input id="p6-discount" name="discount" type="number" min="0" step="0.01"
          defaultValue={previous?.offer.discount ?? '0.00'} required /></div>
      <div className="field"><label htmlFor="p6-lead">{t('leadDays')}</label>
        <input id="p6-lead" name="leadDays" type="number" min="0" max="365"
          defaultValue={previous?.offer.lead_time_days ?? 14} required /></div>
      <div className="field"><label htmlFor="p6-valid">{t('validUntil')}</label>
        <input id="p6-valid" name="validUntil" type="date" required defaultValue={previous?.offer.valid_until} /></div>
      <div className="field"><label htmlFor="p6-terms">{t('terms')}</label>
        <textarea id="p6-terms" name="terms" maxLength={2000} defaultValue={previous?.offer.terms ?? ''} /></div>
    </ActionForm>
  </section>;
}
