'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { archiveProductAction, saveProductAction } from '@/app/[locale]/orgs/[id]/business/products/actions';
import { FormMessage, useRestoringAction } from '@/components/ActionForm';
import Icon from '@/components/ui/Icon';
import { Dialog, Drawer, Switch } from '@/components/ui/Overlay';
import { Link } from '@/i18n/navigation';
import { idle } from '@/lib/form-state';
import { PRODUCT_UNITS, type BizProduct, type ProductStatus } from '@/server/services/biz-products-types';

const STATUS_TONE: Record<ProductStatus, string> = { draft: 'gray', in_review: 'gold', live: 'green', changes_requested: 'coral', rejected: 'coral', archived: 'gray' };
const STATUS_KEY: Record<ProductStatus, string> = { draft: 'statusDraft', in_review: 'statusReview', live: 'statusLive', changes_requested: 'statusChanges', rejected: 'statusRejected', archived: 'statusDraft' };

function Submit({ intent, children, kind }: { intent: 'draft' | 'submit'; children: string; kind: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={`btn btn-${kind}`} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}

function ProductForm({ orgId, product, kind, onDone }: { orgId: string; product: BizProduct | null; kind: 'product' | 'service'; onDone: () => void }) {
  const t = useTranslations('biz2.products');
  const locale = useLocale();
  const [state, action, formRef] = useRestoringAction(saveProductAction);
  const [ask, setAsk] = useState(product?.ask_for_quote ?? false);
  useEffect(() => {
    if (state.status === 'success') onDone();
  }, [state, onDone]);
  const price = product && product.price_cents !== null ? (product.price_cents / 100).toFixed(2) : '';
  return (
    <form ref={formRef} action={action} className="form" style={{ maxWidth: 'none' }}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="id" value={product?.id ?? ''} />
      <input type="hidden" name="version" value={product?.version ?? ''} />
      {product && product.status !== 'draft' ? <p className="message message-warn">{t('editWarn')}</p> : null}
      {product?.review_note ? (
        <p className="message">
          <strong>{t('reviewNote')}: </strong>
          {product.review_note}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="pf-kind">{t('fKind')}</label>
        <select id="pf-kind" name="kind" defaultValue={product?.kind ?? kind}>
          <option value="product">{t('kProduct')}</option>
          <option value="service">{t('kService')}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="pf-name">{t('fName')}</label>
        <input id="pf-name" name="name" type="text" required minLength={2} maxLength={120} defaultValue={product?.name ?? ''} data-autofocus />
      </div>
      <div className="field">
        <label htmlFor="pf-desc">{t('fDesc')}</label>
        <textarea id="pf-desc" name="description" rows={3} maxLength={1000} defaultValue={product?.description ?? ''} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="pf-price">{t('fPrice')}</label>
          <input id="pf-price" name="price" type="text" inputMode="decimal" maxLength={12} defaultValue={price} disabled={ask} />
        </div>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="pf-unit">{t('fPer')}</label>
          <select id="pf-unit" name="unit" defaultValue={product?.unit ?? ''}>
            <option value="" />
            {PRODUCT_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`u${u[0]!.toUpperCase()}${u.slice(1)}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="pf-min">{t('fMin')}</label>
          <input id="pf-min" name="minOrder" type="number" min={1} max={1000000} defaultValue={product?.min_order ?? ''} />
        </div>
      </div>
      <div className="sw-row">
        <span id="pf-hide">{t('fHide')}</span>
        <Switch checked={ask} onChange={setAsk} label={t('fHide')} name="askQuote" />
      </div>
      <FormMessage state={state} />
      <div className="btn-row">
        <Submit intent="draft" kind="secondary">
          {t('saveDraft')}
        </Submit>
        <Submit intent="submit" kind="primary">
          {t('submit')}
        </Submit>
      </div>
    </form>
  );
}

function Remove({ orgId, product, onDone }: { orgId: string; product: BizProduct; onDone: () => void }) {
  const t = useTranslations('biz2.products');
  const tw = useTranslations('ws');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(archiveProductAction, idle);
  useEffect(() => {
    if (state.status === 'success') {
      setOpen(false);
      onDone();
    }
  }, [state, onDone]);
  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
        <Icon name="trash" size={16} />
        {t('archive')}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('archive')} closeLabel={tw('close')}>
        <p style={{ margin: 0 }}>{t('confirmArchive', { name: product.name })}</p>
        <FormMessage state={state} />
        <form action={action} className="btn-row">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="id" value={product.id} />
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-danger" data-autofocus>
            {t('yesRemove')}
          </button>
        </form>
      </Dialog>
    </>
  );
}

export default function ProductsView({ orgId, products, importHref, canEdit }: { orgId: string; products: BizProduct[]; importHref: string | null; canEdit: boolean }) {
  const t = useTranslations('biz2.products');
  const tw = useTranslations('ws');
  const sp = useSearchParams();
  const [tab, setTab] = useState<'product' | 'service'>('product');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [editing, setEditing] = useState<BizProduct | 'new' | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (sp.get('new') === '1' && canEdit) setEditing('new');
  }, [sp, canEdit]);

  const items = products.filter((p) => p.kind === tab);
  const counts = { product: products.filter((p) => p.kind === 'product').length, service: products.filter((p) => p.kind === 'service').length };
  const money = (c: number) => `RM ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const priceText = (p: BizProduct) => (p.ask_for_quote || p.price_cents === null ? t('askQuote') : `${money(p.price_cents)}${p.unit ? ` / ${t(`u${p.unit[0]!.toUpperCase()}${p.unit.slice(1)}`)}` : ''}`);
  const close = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="page-sub">{t('sub')}</p>
        </div>
        {canEdit ? (
          <div className="btn-row">
            {importHref ? (
              <Link className="btn btn-secondary" href={importHref}>
                {t('import')}
              </Link>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={18} stroke={2.2} />
              {tab === 'service' ? t('addService') : t('add')}
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
        <div className="seg" role="group" aria-label={t('tabsLabel')}>
          <button type="button" className="seg-btn" aria-pressed={tab === 'product'} onClick={() => setTab('product')}>
            {t('productsTab')} · {counts.product}
          </button>
          <button type="button" className="seg-btn" aria-pressed={tab === 'service'} onClick={() => setTab('service')}>
            {t('servicesTab')} · {counts.service}
          </button>
        </div>
        <div className="seg" role="group" aria-label={t('viewLabel')}>
          <button type="button" className="seg-btn" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
            {t('viewGrid')}
          </button>
          <button type="button" className="seg-btn" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            {t('viewTable')}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <strong>{t('none')}</strong>
          <span className="mut">{t('noneBody')}</span>
        </div>
      ) : view === 'grid' ? (
        <ul className="prod-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((p) => (
            <li key={p.id}>
              <button type="button" className="prod" onClick={() => canEdit && setEditing(p)} aria-label={`${t('drawerEdit')}: ${p.name}`}>
                <span className="pimg">
                  <Icon name={p.kind === 'service' ? 'settings' : 'box'} size={34} />
                  <span className={`tag t-${STATUS_TONE[p.status]}`} style={{ position: 'absolute', left: 10, top: 10 }}>
                    {t(STATUS_KEY[p.status])}
                  </span>
                </span>
                <span style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
                  <strong style={{ fontSize: '0.95rem' }}>{p.name}</strong>
                  {p.description ? <span className="mut" style={{ fontSize: '0.8125rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</span> : null}
                  <span style={{ fontWeight: 800 }}>{priceText(p)}</span>
                  {p.min_order ? <span className="mut" style={{ fontSize: '0.8125rem' }}>{t('minOrder', { n: p.min_order })}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colPrice')}</th>
                <th scope="col">{t('colMin')}</th>
                <th scope="col">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="btn btn-link" style={{ padding: 0, minHeight: 32, textAlign: 'left' }} onClick={() => canEdit && setEditing(p)}>
                      {p.name}
                    </button>
                    {p.description ? <div className="mut" style={{ fontSize: '0.8125rem' }}>{p.description}</div> : null}
                  </td>
                  <td>{priceText(p)}</td>
                  <td>{p.min_order ?? '–'}</td>
                  <td>
                    <span className={`tag t-${STATUS_TONE[p.status]}`}>{t(STATUS_KEY[p.status])}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={editing !== null} onClose={close} title={editing === 'new' ? t('drawerAdd') : t('drawerEdit')} closeLabel={tw('close')}>
        {editing !== null ? (
          <>
            <ProductForm key={`${formKey}-${editing === 'new' ? 'new' : editing.id}-${editing === 'new' ? 0 : editing.version}`} orgId={orgId} product={editing === 'new' ? null : editing} kind={tab} onDone={close} />
            {editing !== 'new' ? <Remove orgId={orgId} product={editing} onDone={close} /> : null}
          </>
        ) : null}
      </Drawer>
    </>
  );
}
