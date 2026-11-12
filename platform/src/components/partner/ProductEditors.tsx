'use client';

import { useTranslations } from 'next-intl';
import type { TierProblem } from '@/lib/partner-ui';

/** Row editors for the product form (price tiers, options/variants, specifications). Controlled by the parent, which serialises them into hidden fields. */

export interface TierRowState {
  id: number;
  variant_sku: string;
  min_qty: string;
  max_qty: string;
  unit_price: string;
}
export interface VariantRowState {
  id: number;
  sku: string;
  label: string;
  /** "key: value" per line */
  attributes: string;
  moq: string;
}
export interface SpecRowState {
  id: number;
  key: string;
  value: string;
}

const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="btn btn-secondary" onClick={onClick}>
    {label}
  </button>
);

export function TierEditor({
  rows,
  onChange,
  problems,
  variants,
  currency,
  nextId,
}: {
  rows: TierRowState[];
  onChange: (rows: TierRowState[]) => void;
  problems: TierProblem[];
  variants: string[];
  currency: string;
  nextId: () => number;
}) {
  const t = useTranslations('p5partner.productForm.tiers');
  const te = useTranslations('errors');
  const set = (i: number, patch: Partial<TierRowState>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="repeat" data-testid="tier-editor">
      <p className="hint">{t('hint')}</p>
      {rows.map((r, i) => {
        const problem = problems.find((p) => p.row === i);
        const pid = `tier-${r.id}`;
        return (
          <fieldset key={r.id} className="repeat-row" aria-describedby={problem ? `${pid}-err` : undefined}>
            <legend>{t('row', { n: i + 1 })}</legend>
            {variants.length > 0 ? (
              <div className="field">
                <label htmlFor={`${pid}-v`}>{t('variant')}</label>
                <select id={`${pid}-v`} value={r.variant_sku} onChange={(e) => set(i, { variant_sku: e.target.value })}>
                  <option value="">{t('wholeProduct')}</option>
                  {variants.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor={`${pid}-min`}>{t('from')}</label>
              <input id={`${pid}-min`} type="text" inputMode="numeric" value={r.min_qty} onChange={(e) => set(i, { min_qty: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${pid}-max`}>{t('to')}</label>
              <input id={`${pid}-max`} type="text" inputMode="numeric" value={r.max_qty} onChange={(e) => set(i, { max_qty: e.target.value })} aria-describedby={`${pid}-maxhint`} />
              <p id={`${pid}-maxhint`} className="hint">
                {t('toHint')}
              </p>
            </div>
            <div className="field">
              <label htmlFor={`${pid}-price`}>{t('price', { currency })}</label>
              <input id={`${pid}-price`} type="text" inputMode="decimal" value={r.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} />
            </div>
            {problem ? (
              <p id={`${pid}-err`} className="message message-error" role="alert">
                <strong>{t('problem')}: </strong>
                {te(problem.key)}
              </p>
            ) : null}
            <RemoveButton label={t('remove', { n: i + 1 })} onClick={() => onChange(rows.filter((_, n) => n !== i))} />
          </fieldset>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { id: nextId(), variant_sku: '', min_qty: '', max_qty: '', unit_price: '' }])}>
        {t('add')}
      </button>
    </div>
  );
}

export function VariantEditor({ rows, onChange, nextId }: { rows: VariantRowState[]; onChange: (rows: VariantRowState[]) => void; nextId: () => number }) {
  const t = useTranslations('p5partner.productForm.variants');
  const set = (i: number, patch: Partial<VariantRowState>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="repeat" data-testid="variant-editor">
      <p className="hint">{t('hint')}</p>
      {rows.map((r, i) => {
        const pid = `variant-${r.id}`;
        return (
          <fieldset key={r.id} className="repeat-row">
            <legend>{t('row', { n: i + 1 })}</legend>
            <div className="field">
              <label htmlFor={`${pid}-label`}>{t('label')}</label>
              <input id={`${pid}-label`} type="text" value={r.label} maxLength={80} onChange={(e) => set(i, { label: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${pid}-sku`}>{t('sku')}</label>
              <input id={`${pid}-sku`} type="text" value={r.sku} maxLength={40} onChange={(e) => set(i, { sku: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${pid}-attr`}>{t('attributes')}</label>
              <p id={`${pid}-attrhint`} className="hint">
                {t('attributesHint')}
              </p>
              <textarea id={`${pid}-attr`} rows={2} value={r.attributes} onChange={(e) => set(i, { attributes: e.target.value })} aria-describedby={`${pid}-attrhint`} />
            </div>
            <div className="field">
              <label htmlFor={`${pid}-moq`}>{t('moq')}</label>
              <input id={`${pid}-moq`} type="text" inputMode="numeric" value={r.moq} onChange={(e) => set(i, { moq: e.target.value })} />
            </div>
            <RemoveButton label={t('remove', { n: i + 1 })} onClick={() => onChange(rows.filter((_, n) => n !== i))} />
          </fieldset>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { id: nextId(), sku: '', label: '', attributes: '', moq: '' }])}>
        {t('add')}
      </button>
    </div>
  );
}

export function SpecEditor({ rows, onChange, nextId }: { rows: SpecRowState[]; onChange: (rows: SpecRowState[]) => void; nextId: () => number }) {
  const t = useTranslations('p5partner.productForm.specs');
  const set = (i: number, patch: Partial<SpecRowState>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="repeat" data-testid="spec-editor">
      <p className="hint">{t('hint')}</p>
      {rows.map((r, i) => {
        const pid = `spec-${r.id}`;
        return (
          <fieldset key={r.id} className="repeat-row">
            <legend>{t('row', { n: i + 1 })}</legend>
            <div className="field">
              <label htmlFor={`${pid}-k`}>{t('key')}</label>
              <input id={`${pid}-k`} type="text" value={r.key} maxLength={60} onChange={(e) => set(i, { key: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`${pid}-v`}>{t('value')}</label>
              <input id={`${pid}-v`} type="text" value={r.value} maxLength={200} onChange={(e) => set(i, { value: e.target.value })} />
            </div>
            <RemoveButton label={t('remove', { n: i + 1 })} onClick={() => onChange(rows.filter((_, n) => n !== i))} />
          </fieldset>
        );
      })}
      <button type="button" className="btn btn-secondary" onClick={() => onChange([...rows, { id: nextId(), key: '', value: '' }])}>
        {t('add')}
      </button>
    </div>
  );
}
