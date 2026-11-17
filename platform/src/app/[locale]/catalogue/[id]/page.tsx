import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import CardActions from '@/components/catalogue/CardActions';
import { AvailabilityNote, PriceSummary, PriceTiers, VerificationNote } from '@/components/catalogue/Notes';
import { ProductImage } from '@/components/catalogue/ProductCard';
import { SelectField, TextArea } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { leadTimeLabel } from '@/lib/p5-format';
import { REPORT_PRODUCT_REASON_LIST } from '@/lib/schemas';
import { getOptionalUser } from '@/server/session';
import { reportProductAction } from '../actions';
import { loadItem, savedIdSet } from '../data';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const item = await loadItem(id);
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  return { title: item ? item.name : t('notFound.title') };
}

/** Product page. Anyone may read it; a product that is not currently visible is a plain 404 (nothing about it is revealed). */
export default async function ProductPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const item = await loadItem(id);
  if (!item) notFound();
  const t = await getTranslations({ locale, namespace: 'p5buyer' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const t6 = await getTranslations({ locale, namespace: 'p6' });
  const { supabase, user } = await getOptionalUser();
  const saved = (await savedIdSet(supabase, Boolean(user))).has(id);
  const place = [item.supplier.state_city, item.supplier.country].filter(Boolean).join(', ');
  const lead = leadTimeLabel((k, v) => tc(k, v), item.lead_time_min_days, item.lead_time_max_days);
  const specEntries = Object.entries(item.specs ?? {}).filter(([, v]) => v !== null && String(v).trim() !== '');
  const sd = item.supplier_detail;

  return (
    <article aria-labelledby="product-h">
      <p>
        <Link href="/catalogue" locale={locale}>
          {t('detail.back')}
        </Link>
      </p>
      <h1 id="product-h">{item.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {tc(`categories.${item.category_slug}`)} · {tc('labels.sku')}: {item.sku}
      </p>

      <div className="catalogue-detail-top">
        <section aria-label={t('detail.images')} className="catalogue-gallery">
          {item.media.length > 0 ? (
            <ul className="catalogue-gallery-list">
              {item.media.map((m, i) => (
                <li key={m.id}>
                  <ProductImage id={m.id} alt={m.alt?.trim() || t('card.imageAlt', { name: item.name })} className={i === 0 ? 'p5-thumb' : 'p5-thumb catalogue-thumb-small'} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('detail.noImages')}</p>
          )}
        </section>

        <section aria-labelledby="buy-h" className="card catalogue-buy">
          <h2 id="buy-h" style={{ marginTop: 0 }}>
            {t('detail.priceTitle')}
          </h2>
          <PriceSummary priceMode={item.price_mode} fromPrice={item.from_price} currency={item.currency} unit={item.unit} confirmedOn={item.price_confirmed_on} locale={locale} />
          <p className="muted">{t('detail.notQuotation')}</p>
          <dl className="dl">
            <dt>{tc('labels.moq')}</dt>
            <dd>
              {item.moq} {tc(`units.${item.unit}`)}
            </dd>
            <dt>{tc('labels.leadTime')}</dt>
            <dd>{lead ?? t('detail.notProvided')}</dd>
          </dl>
          <AvailabilityNote status={item.availability_status} confirmedOn={item.availability_confirmed_on} outdated={item.availability_outdated} locale={locale} />
          <div className="catalogue-card-actions">
            <CardActions id={item.id} name={item.name} locale={locale} signedIn={Boolean(user)} saved={saved} nextPath={`/${locale}/catalogue/${id}`} />
            <Link href={`/sourcing/new?product=${item.id}`} locale={locale} className="btn btn-secondary">{t6('send')}</Link>
          </div>
        </section>
      </div>

      {item.description ? (
        <section aria-labelledby="desc-h" className="acard">
          <h2 id="desc-h">{t('detail.description')}</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{item.description}</p>
        </section>
      ) : null}

      <section aria-labelledby="tiers-h" className="acard">
        <h2 id="tiers-h">{t('detail.tiersTitle')}</h2>
        {item.price_mode === 'request' || item.tiers.length === 0 ? (
          item.price_mode === 'fixed' && item.from_price !== null ? <p>{t('detail.fixedPriceNote')}</p> : <p>{tc('price.onRequest')}</p>
        ) : (
          <>
            <p className="muted">{t('detail.tiersIntro', { currency: item.currency })}</p>
            <PriceTiers tiers={item.tiers} currency={item.currency} unit={item.unit} variants={item.variants} locale={locale} />
          </>
        )}
        <p className="muted">{t('detail.noConversion')}</p>
      </section>

      {item.variants.length > 0 ? (
        <section aria-labelledby="var-h" className="acard">
          <h2 id="var-h">{t('detail.variants')}</h2>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th scope="col">{t('detail.variantName')}</th>
                  <th scope="col">{tc('labels.sku')}</th>
                  <th scope="col">{t('detail.variantDetails')}</th>
                  <th scope="col">{tc('labels.moq')}</th>
                </tr>
              </thead>
              <tbody>
                {item.variants.map((v) => (
                  <tr key={v.id}>
                    <td data-label={t('detail.variantName')}>{v.label}</td>
                    <td data-label={tc('labels.sku')}>{v.sku}</td>
                    <td data-label={t('detail.variantDetails')}>
                      {Object.entries(v.attributes ?? {})
                        .map(([k, val]) => `${k}: ${val}`)
                        .join(', ') || t('detail.notProvided')}
                    </td>
                    <td data-label={tc('labels.moq')}>{v.moq ?? item.moq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {specEntries.length > 0 || item.packaging ? (
        <section aria-labelledby="spec-h" className="acard">
          <h2 id="spec-h">{t('detail.specs')}</h2>
          <dl className="dl">
            {specEntries.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
            {item.packaging ? (
              <>
                <dt>{t('detail.packaging')}</dt>
                <dd>{item.packaging}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="sup-h" className="card">
        <h2 id="sup-h" style={{ marginTop: 0 }}>
          {t('detail.supplierTitle')}
        </h2>
        <p style={{ margin: 0 }}>
          <strong>{item.supplier.name}</strong>
          {place ? <span className="muted"> · {place}</span> : null}
        </p>
        {sd.main_category ? <p className="muted">{tc(`categories.${sd.main_category}`)}</p> : null}
        {sd.description ? <p style={{ whiteSpace: 'pre-line' }}>{sd.description}</p> : null}
        {sd.capabilities && sd.capabilities.length > 0 ? (
          <>
            <h3>{t('detail.capabilities')}</h3>
            <ul>
              {sd.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ) : null}
        <VerificationNote reviewed={item.supplier.reviewed} locale={locale} />
        <p>
          <Link href={`/catalogue?supplier=${item.supplier.id}`} locale={locale}>
            {t('detail.moreFromSupplier')}
          </Link>
        </p>
      </section>

      <section aria-labelledby="rep-h" className="acard">
        <h2 id="rep-h">{t('report.title')}</h2>
        {user ? (
          <details>
            <summary>{t('report.open')}</summary>
            <ActionForm action={reportProductAction} submitLabel={t('report.send')} variant="secondary">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="productId" value={item.id} />
              <SelectField id="reason" name="reason" label={t('report.reason')} defaultValue="misleading">
                {REPORT_PRODUCT_REASON_LIST.map((x) => (
                  <option key={x} value={x}>
                    {tc(`reportReasons.${x}`)}
                  </option>
                ))}
              </SelectField>
              <TextArea id="rnote" name="note" label={t('report.note')} maxLength={500} />
            </ActionForm>
          </details>
        ) : (
          <p>
            <Link href={`/login?next=${encodeURIComponent(`/${locale}/catalogue/${id}`)}`} locale={locale}>
              {t('report.signIn')}
            </Link>
          </p>
        )}
      </section>
    </article>
  );
}
