'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { decideProductAction } from '@/app/[locale]/admin/products/actions';
import { FormMessage } from '@/components/ActionForm';
import { Drawer } from '@/components/ui/Overlay';
import { idle } from '@/lib/form-state';
import type { AdminBizProduct } from '@/server/services/biz-products-types';

const DECISIONS = [
  ['approve', 'approve'],
  ['request_changes', 'changes'],
  ['reject', 'reject'],
] as const;

function Form({ p, onDone }: { p: AdminBizProduct; onDone: () => void }) {
  const t = useTranslations('adm2.products');
  const [state, action] = useActionState(decideProductAction, idle);
  const [decision, setDecision] = useState<string>('');
  useEffect(() => {
    if (state.status === 'success') onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="form" style={{ maxWidth: 'none' }}>
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="version" value={p.version} />
      <div role="radiogroup" aria-label={t('save')} className="seg" style={{ width: '100%' }}>
        {DECISIONS.map(([value, key]) => (
          <label key={value} className="seg-btn" style={{ flex: 1, cursor: 'pointer' }} aria-pressed={decision === value}>
            <input type="radio" name="decision" value={value} className="sr" checked={decision === value} onChange={() => setDecision(value)} required />
            {t(key)}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="pr-note">{t('note')}</label>
        <p className="hint">{t('noteHint')}</p>
        <textarea id="pr-note" name="note" rows={3} maxLength={500} />
      </div>
      <FormMessage state={state} />
      <button type="submit" className="btn btn-primary" disabled={!decision}>
        {t('save')}
      </button>
    </form>
  );
}

/** Queue of business products waiting for MITRA, with a right-hand review drawer. */
export default function ProductReview({ items }: { items: (AdminBizProduct & { priceText: string })[] }) {
  const t = useTranslations('adm2.products');
  const ta = useTranslations('adm2');
  const tw = useTranslations('ws');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('colBusiness')}</th>
              <th scope="col">{t('colItem')}</th>
              <th scope="col">{t('colPrice')}</th>
              <th scope="col">{t('colStatus')}</th>
              <th scope="col">
                <span className="sr">{t('save')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={p.id === openId ? 'sel' : undefined}>
                <td>{p.org_name}</td>
                <td>
                  <strong>{p.name}</strong>
                  {p.description ? <div className="mut" style={{ fontSize: '0.8125rem' }}>{p.description}</div> : null}
                </td>
                <td>{p.priceText}</td>
                <td>
                  <span className={`tag t-${p.status === 'live' ? 'green' : p.status === 'in_review' ? 'gold' : 'gray'}`}>{p.status}</span>
                </td>
                <td>
                  {p.status === 'in_review' ? (
                    <button type="button" className="btn btn-secondary btn-sm" aria-label={`${ta('review')}: ${p.name}`} onClick={() => setOpenId(p.id)}>
                      {ta('review')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpenId(null)} title={open?.name ?? ''} closeLabel={tw('close')} wide>
        {open ? (
          <>
            <dl className="dl" style={{ margin: 0 }}>
              <dt>{t('colBusiness')}</dt>
              <dd>{open.org_name}</dd>
              <dt>{t('colPrice')}</dt>
              <dd>{open.priceText}</dd>
              {open.description ? (
                <>
                  <dt>{t('colItem')}</dt>
                  <dd>{open.description}</dd>
                </>
              ) : null}
            </dl>
            <Form p={open} onDone={() => setOpenId(null)} />
          </>
        ) : null}
      </Drawer>
    </>
  );
}
