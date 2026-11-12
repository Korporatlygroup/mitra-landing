'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { createProductAction, updateProductAction } from '@/app/[locale]/orgs/[id]/partner/products/actions';
import { validateTiers } from '@/lib/partner-ui';
import { PRODUCT_AVAILABILITY, PRODUCT_CATEGORY_SLUGS, PRODUCT_CURRENCIES, PRODUCT_PRICE_MODES, PRODUCT_UNITS } from '@/lib/schemas';
import type { ProductData } from '@/server/services/p5-types';
import PartnerForm from './PartnerForm';
import { SpecEditor, TierEditor, VariantEditor, type SpecRowState, type TierRowState, type VariantRowState } from './ProductEditors';

interface Props {
  mode: 'create' | 'edit';
  locale: string;
  orgId: string;
  suppliers: { id: string; name: string }[];
  supplierId: string;
  productId?: string;
  /** The product's draft_version (optimistic lock for edits). */
  draftVersion?: number;
  sku?: string;
  draft: ProductData;
  today: string;
  reloadHref?: string;
}

/** Row ids only need to be unique in this browser tab. */
let rowId = 1;
const nextId = () => rowId++;

const attrsToText = (a: Record<string, string> | undefined) => Object.entries(a ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
const textToAttrs = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of s.split(/\n|;/)) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(0, i).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};

/**
 * Create / edit a product draft. Money stays a decimal string end to end. Tiers, options and specifications are edited as rows and sent as JSON in
 * hidden fields. Price tiers are checked live (order, gaps, overlap, open last tier); the database repeats every check when the product is submitted.
 */
export default function ProductForm({ mode, locale, orgId, suppliers, supplierId, productId, draftVersion, sku, draft, today, reloadHref }: Props) {
  const t = useTranslations('p5partner.productForm');
  const tc = useTranslations('p5common');
  const tt = useTranslations('p5partner.common');

  const [priceMode, setPriceMode] = useState<string>(draft.price_mode ?? 'fixed');
  const [currency, setCurrency] = useState<string>(draft.currency ?? 'INR');
  const [moq, setMoq] = useState<string>(draft.moq != null ? String(draft.moq) : '');
  const [tiers, setTiers] = useState<TierRowState[]>(() =>
    (draft.tiers ?? []).map((r) => ({ id: nextId(), variant_sku: r.variant_sku ?? '', min_qty: String(r.min_qty), max_qty: r.max_qty == null ? '' : String(r.max_qty), unit_price: String(r.unit_price) })),
  );
  const [variants, setVariants] = useState<VariantRowState[]>(() =>
    (draft.variants ?? []).map((v) => ({ id: nextId(), sku: v.sku, label: v.label, attributes: attrsToText(v.attributes), moq: v.moq != null ? String(v.moq) : '' })),
  );
  const [specs, setSpecs] = useState<SpecRowState[]>(() => Object.entries(draft.specs ?? {}).map(([key, value]) => ({ id: nextId(), key, value: String(value) })));

  const moqNumber = /^\d{1,10}$/.test(moq.trim()) ? Number(moq) : null;
  const problems = useMemo(() => (priceMode === 'tiers' ? validateTiers(tiers, moqNumber) : []), [priceMode, tiers, moqNumber]);
  const variantSkus = variants.map((v) => v.sku.trim()).filter(Boolean);

  const tiersJson = JSON.stringify(
    tiers.map((r) => ({
      min_qty: r.min_qty.trim(),
      ...(r.max_qty.trim() ? { max_qty: r.max_qty.trim() } : {}),
      unit_price: r.unit_price.trim(),
      ...(r.variant_sku ? { variant_sku: r.variant_sku } : {}),
    })),
  );
  const variantsJson = JSON.stringify(
    variants.map((v) => ({ sku: v.sku.trim(), label: v.label.trim(), attributes: textToAttrs(v.attributes), ...(v.moq.trim() ? { moq: v.moq.trim() } : {}) })),
  );
  const specObj: Record<string, string> = {};
  for (const s of specs) if (s.key.trim()) specObj[s.key.trim()] = s.value.trim();
  const specsJson = Object.keys(specObj).length ? JSON.stringify(specObj) : '';

  const extra = mode === 'edit' ? [{ label: t('saveAndPreview'), value: 'preview' }, { label: t('saveAndSubmit'), value: 'submit' }] : [{ label: t('saveAndPreview'), value: 'preview' }];
  const unitInList = !draft.unit || (PRODUCT_UNITS as readonly string[]).includes(draft.unit);

  return (
    <PartnerForm
      action={mode === 'create' ? createProductAction : updateProductAction}
      submitLabel={mode === 'create' ? tc('buttons.saveDraft') : tc('buttons.saveChanges')}
      extra={extra}
      reloadHref={reloadHref}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      {mode === 'edit' ? (
        <>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="supplierId" value={supplierId} />
          <input type="hidden" name="expectedVersion" value={draftVersion} />
        </>
      ) : null}
      <input type="hidden" name="tiers" value={priceMode === 'tiers' ? tiersJson : ''} />
      <input type="hidden" name="variants" value={variantsJson} />
      <input type="hidden" name="specs" value={specsJson} />

      <section aria-labelledby="pf-basic" className="form-section">
        <h2 id="pf-basic">{t('basicTitle')}</h2>
        {mode === 'create' ? (
          <div className="field">
            <label htmlFor="supplierId">{t('supplier')}</label>
            <select id="supplierId" name="supplierId" defaultValue={supplierId} required>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p>
            <strong>{t('supplier')}:</strong> {suppliers.find((s) => s.id === supplierId)?.name ?? '-'}
          </p>
        )}
        {mode === 'create' ? (
          <div className="field">
            <label htmlFor="sku">{tc('labels.sku')}</label>
            <p id="sku-hint" className="hint">
              {t('skuHint')}
            </p>
            <input id="sku" name="sku" type="text" required maxLength={40} aria-describedby="sku-hint" defaultValue="" />
          </div>
        ) : (
          <p>
            <strong>{tc('labels.sku')}:</strong> {sku} <span className="hint">({t('skuLocked')})</span>
          </p>
        )}
        <div className="field">
          <label htmlFor="name">{t('name')}</label>
          <input id="name" name="name" type="text" defaultValue={draft.name ?? ''} maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="category_slug">{t('category')}</label>
          <select id="category_slug" name="category_slug" defaultValue={draft.category_slug ?? ''}>
            <option value="">{t('categoryChoose')}</option>
            {PRODUCT_CATEGORY_SLUGS.map((s) => (
              <option key={s} value={s}>
                {tc(`categories.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="description">{t('description')}</label>
          <p id="description-hint" className="hint">
            {t('descriptionHint')}
          </p>
          <textarea id="description" name="description" rows={5} maxLength={2000} defaultValue={draft.description ?? ''} aria-describedby="description-hint" />
        </div>
        <div className="field">
          <label htmlFor="unit">{t('unit')}</label>
          <select id="unit" name="unit" defaultValue={draft.unit ?? ''}>
            <option value="">{t('unitChoose')}</option>
            {!unitInList && draft.unit ? <option value={draft.unit}>{draft.unit}</option> : null}
            {PRODUCT_UNITS.map((u) => (
              <option key={u} value={u}>
                {tc(`units.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="moq">{t('moq')}</label>
          <p id="moq-hint" className="hint">
            {t('moqHint')}
          </p>
          <input id="moq" name="moq" type="text" inputMode="numeric" value={moq} onChange={(e) => setMoq(e.target.value)} aria-describedby="moq-hint" />
        </div>
      </section>

      <section aria-labelledby="pf-price" className="form-section">
        <h2 id="pf-price">{t('priceTitle')}</h2>
        <div className="field">
          <label htmlFor="currency">{t('currency')}</label>
          <p id="currency-hint" className="hint">
            {t('currencyHint')}
          </p>
          <select id="currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-describedby="currency-hint">
            {PRODUCT_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {tc(`currencies.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend>{t('priceMode')}</legend>
          {PRODUCT_PRICE_MODES.map((m) => (
            <div key={m} className="radio">
              <input id={`pm-${m}`} type="radio" name="price_mode" value={m} checked={priceMode === m} onChange={() => setPriceMode(m)} />
              <label htmlFor={`pm-${m}`}>{tc(`price.${m}`)}</label>
            </div>
          ))}
        </fieldset>
        {priceMode === 'fixed' ? (
          <div className="field">
            <label htmlFor="unit_price">{t('unitPrice', { currency })}</label>
            <p id="unit_price-hint" className="hint">
              {t('unitPriceHint')}
            </p>
            <input id="unit_price" name="unit_price" type="text" inputMode="decimal" defaultValue={draft.unit_price != null ? String(draft.unit_price) : ''} aria-describedby="unit_price-hint" />
          </div>
        ) : null}
        {priceMode === 'tiers' ? (
          <>
            <h3>{t('tiers.title')}</h3>
            <TierEditor rows={tiers} onChange={setTiers} problems={problems} variants={variantSkus} currency={currency} nextId={nextId} />
            <div aria-live="polite" className="form-message-slot" data-testid="tier-summary">
              {tiers.length > 0 && problems.length === 0 ? <p className="message message-ok">{t('tiers.allGood')}</p> : null}
            </div>
          </>
        ) : null}
        {priceMode === 'request' ? <p className="hint">{t('requestNote')}</p> : null}
        <div className="field">
          <label htmlFor="price_confirmed_on">{t('priceConfirmedOn')}</label>
          <p id="pco-hint" className="hint">
            {t('confirmedHint')}
          </p>
          <input id="price_confirmed_on" name="price_confirmed_on" type="date" max={today} defaultValue={draft.price_confirmed_on ?? ''} aria-describedby="pco-hint" />
        </div>
      </section>

      <section aria-labelledby="pf-variants" className="form-section">
        <h2 id="pf-variants">{t('variants.title')}</h2>
        <VariantEditor rows={variants} onChange={setVariants} nextId={nextId} />
      </section>

      <section aria-labelledby="pf-specs" className="form-section">
        <h2 id="pf-specs">{t('specs.title')}</h2>
        <SpecEditor rows={specs} onChange={setSpecs} nextId={nextId} />
        <div className="field">
          <label htmlFor="packaging">{t('packaging')}</label>
          <p id="packaging-hint" className="hint">
            {t('packagingHint')}
          </p>
          <input id="packaging" name="packaging" type="text" maxLength={300} defaultValue={draft.packaging ?? ''} aria-describedby="packaging-hint" />
        </div>
      </section>

      <section aria-labelledby="pf-supply" className="form-section">
        <h2 id="pf-supply">{t('supplyTitle')}</h2>
        <div className="field">
          <label htmlFor="lead_time_min_days">{t('leadMin')}</label>
          <input id="lead_time_min_days" name="lead_time_min_days" type="text" inputMode="numeric" defaultValue={draft.lead_time_min_days != null ? String(draft.lead_time_min_days) : ''} />
        </div>
        <div className="field">
          <label htmlFor="lead_time_max_days">{t('leadMax')}</label>
          <input id="lead_time_max_days" name="lead_time_max_days" type="text" inputMode="numeric" defaultValue={draft.lead_time_max_days != null ? String(draft.lead_time_max_days) : ''} />
        </div>
        <div className="field">
          <label htmlFor="availability_status">{t('availability')}</label>
          <select id="availability_status" name="availability_status" defaultValue={draft.availability_status ?? ''}>
            <option value="">{t('availabilityChoose')}</option>
            {PRODUCT_AVAILABILITY.map((a) => (
              <option key={a} value={a}>
                {tc(`availability.${a}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="availability_confirmed_on">{t('availabilityConfirmedOn')}</label>
          <p id="aco-hint" className="hint">
            {t('confirmedHint')}
          </p>
          <input id="availability_confirmed_on" name="availability_confirmed_on" type="date" max={today} defaultValue={draft.availability_confirmed_on ?? ''} aria-describedby="aco-hint" />
        </div>
      </section>
      <p className="hint">{tt('requiredNote')}</p>
    </PartnerForm>
  );
}
