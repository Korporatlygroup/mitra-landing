'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createSourcingAction } from '@/app/[locale]/sourcing/actions';
import ActionForm from '@/components/ActionForm';
import type { SourcingPartner } from '@/server/services/p6-sourcing';

type Line = { name: string; unit: string; quantity: string; specification: string; category_slug?: string; product_id?: string };
export default function NewRequestForm({
  locale, orgs, partners, states, categories, initial, initialState, initialCity, defaultOrg,
}: {
  locale: string; orgs: Array<{ id: string; name: string }>; partners: SourcingPartner[];
  states: readonly string[]; categories: readonly string[]; initial?: Line[]; initialState?: string; initialCity?: string;
  defaultOrg?: string;
}) {
  const t = useTranslations('p6');
  const categoriesT = useTranslations('p5common.categories');
  const [key] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>(initial?.length ? initial : [{ name: '', unit: '', quantity: '1', specification: '' }]);
  const update = (index: number, field: keyof Line, value: string) => setLines((prev) =>
    prev.map((line, n) => n === index ? { ...line, [field]: value } : line));
  return (
    <ActionForm action={createSourcingAction} submitLabel={t('send')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="key" value={key} />
      <input type="hidden" name="items" value={JSON.stringify(lines.map((line) => ({
        ...(line.product_id ? { product_id: line.product_id } :
          { name: line.name, unit: line.unit, category_slug: line.category_slug || undefined }),
        quantity: line.quantity, specification: line.specification,
      })))} />
      <div className="field">
        <label htmlFor="buyer-org">{t('yourBusiness')}</label>
        <select id="buyer-org" name="org" defaultValue={defaultOrg ?? orgs[0]?.id} required>
          {orgs.map((org) => <option value={org.id} key={org.id}>{org.name}</option>)}
        </select>
      </div>
      <h2>{t('items')}</h2>
      {lines.map((line, index) => (
        <fieldset className="card" key={index}>
          <legend>{t('product')} {index + 1}</legend>
          <div className="field">
            <label htmlFor={`product-${index}`}>{t('product')}</label>
            <input id={`product-${index}`} value={line.name} onChange={(e) => update(index, 'name', e.target.value)}
              maxLength={160} required disabled={Boolean(line.product_id)} />
          </div>
          <div className="field">
            <label htmlFor={`quantity-${index}`}>{t('quantity')}</label>
            <input id={`quantity-${index}`} type="number" min="0.001" step="0.001" inputMode="decimal"
              value={line.quantity} onChange={(e) => update(index, 'quantity', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor={`unit-${index}`}>{t('unit')}</label>
            <input id={`unit-${index}`} value={line.unit} onChange={(e) => update(index, 'unit', e.target.value)}
              maxLength={40} required disabled={Boolean(line.product_id)} />
          </div>
          {!line.product_id ? <div className="field">
            <label htmlFor={`category-${index}`}>{t('category')}</label>
            <select id={`category-${index}`} value={line.category_slug ?? ''}
              onChange={(e) => update(index, 'category_slug', e.target.value)}>
              <option value="">{t('categoryUnknown')}</option>
              {categories.map((category) => <option key={category} value={category}>
                {categoriesT.has(category) ? categoriesT(category) : category.replaceAll('-', ' ')}
              </option>)}
            </select>
          </div> : null}
          <div className="field">
            <label htmlFor={`spec-${index}`}>{t('specification')}</label>
            <textarea id={`spec-${index}`} value={line.specification}
              onChange={(e) => update(index, 'specification', e.target.value)} maxLength={2000} />
          </div>
          {lines.length > 1 ? <button type="button" className="btn btn-secondary"
            onClick={() => setLines((prev) => prev.filter((_, n) => n !== index))}>{t('removeProduct')}</button> : null}
        </fieldset>
      ))}
      {lines.length < 20 ? <button type="button" className="btn btn-secondary"
        onClick={() => setLines((prev) => [...prev, { name: '', unit: '', quantity: '1', specification: '' }])}>
        {t('addProduct')}
      </button> : null}
      <div className="field">
        <label htmlFor="p6-state">{t('deliveryState')}</label>
        <select id="p6-state" name="state" defaultValue={initialState || ''} required>
          <option value="" disabled>{t('deliveryState')}</option>
          {states.map((state) => <option key={state} value={state}>{state}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="p6-city">{t('deliveryCity')}</label>
        <input id="p6-city" name="city" maxLength={80} defaultValue={initialCity} /></div>
      <div className="field"><label htmlFor="p6-date">{t('neededBy')}</label>
        <input id="p6-date" type="date" name="neededBy" min={new Date().toISOString().slice(0, 10)} /></div>
      <div className="field"><label htmlFor="p6-note">{t('note')}</label>
        <textarea id="p6-note" name="note" maxLength={2000} /></div>
      <fieldset>
        <legend>{t('partners')}</legend>
        <p className="hint">{t('partnerHint')}</p>
        {partners.map((partner) => <label key={partner.id} className="card" style={{ display: 'block' }}>
          <input type="checkbox" name="partner" value={partner.id} /> {partner.name}
        </label>)}
      </fieldset>
    </ActionForm>
  );
}
