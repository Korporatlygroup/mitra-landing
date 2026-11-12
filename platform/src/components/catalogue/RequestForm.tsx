'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { requestPriceAction } from '@/app/[locale]/catalogue/actions';
import ActionForm from '@/components/ActionForm';
import { Link } from '@/i18n/navigation';

export interface RequestFormVariant {
  sku: string;
  label: string;
  moq: number | null;
}

/**
 * The Request Price form. The idempotency key is received once from the server and kept in state for the life of the form, so a double
 * click, a retry after an error or a lost answer sends the SAME key and returns the same request instead of making a second one.
 */
export default function RequestForm({
  locale,
  productId,
  initialKey,
  orgs,
  variants,
  moq,
  unitLabel,
  states,
  minDate,
  loginNext,
}: {
  locale: string;
  productId: string;
  initialKey: string;
  orgs: { id: string; name: string }[];
  variants: RequestFormVariant[];
  moq: number;
  unitLabel: string;
  states: readonly string[];
  minDate: string;
  loginNext: string;
}) {
  const t = useTranslations('p5buyer.request');
  const [key] = useState(initialKey);
  return (
    <ActionForm action={requestPriceAction} submitLabel={t('submit')}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="key" value={key} />

      {orgs.length > 1 ? (
        <div className="field">
          <label htmlFor="buyerOrgId">{t('as')}</label>
          <select id="buyerOrgId" name="buyerOrgId" defaultValue={orgs[0]!.id}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : orgs.length === 1 ? (
        <input type="hidden" name="buyerOrgId" value={orgs[0]!.id} />
      ) : null}

      {variants.length > 0 ? (
        <div className="field">
          <label htmlFor="variantSku">{t('variant')}</label>
          <p className="hint" id="variant-hint">
            {t('variantHint')}
          </p>
          <select id="variantSku" name="variantSku" defaultValue="" aria-describedby="variant-hint">
            <option value="">{t('variantAny')}</option>
            {variants.map((v) => (
              <option key={v.sku} value={v.sku}>
                {v.label}
                {v.moq != null ? ` (${t('variantMoq', { moq: v.moq })})` : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="quantity">{t('quantity', { unit: unitLabel })}</label>
        <p className="hint" id="quantity-hint">
          {t('quantityHint', { moq, unit: unitLabel })}
        </p>
        <input id="quantity" name="quantity" type="number" inputMode="numeric" min={1} step={1} defaultValue={moq} required aria-describedby="quantity-hint" />
      </div>

      <div className="field">
        <label htmlFor="destinationState">{t('state')}</label>
        <select id="destinationState" name="destinationState" defaultValue="" required>
          <option value="">{t('statePick')}</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="destinationCity">{t('city')}</label>
        <input id="destinationCity" name="destinationCity" type="text" maxLength={100} autoComplete="address-level2" />
      </div>
      <div className="field">
        <label htmlFor="neededBy">{t('neededBy')}</label>
        <p className="hint" id="needed-hint">
          {t('neededByHint')}
        </p>
        <input id="neededBy" name="neededBy" type="date" min={minDate} aria-describedby="needed-hint" />
      </div>
      <div className="field">
        <label htmlFor="notes">{t('notes')}</label>
        <p className="hint" id="notes-hint">
          {t('notesHint')}
        </p>
        <textarea id="notes" name="notes" rows={5} maxLength={1000} aria-describedby="notes-hint" />
      </div>
      <p className="muted">{t('privacy')}</p>
      <p className="muted">
        {t('sessionNote')}{' '}
        <Link href={`/login?next=${encodeURIComponent(loginNext)}`} locale={locale} target="_blank" rel="noopener">
          {t('signInAgain')}
        </Link>
      </p>
    </ActionForm>
  );
}
