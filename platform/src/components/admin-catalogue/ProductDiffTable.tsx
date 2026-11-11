import { getTranslations } from 'next-intl/server';
import { ENUM_FIELDS, type DiffRow } from './helpers';

/**
 * Field-by-field comparison of the live and the submitted revision. Changed rows say "Changed" in words (never colour alone).
 * Stacks into cards on phones (table.stack).
 */
export default async function ProductDiffTable({ locale, rows, hasLive }: { locale: string; rows: DiffRow[]; hasLive: boolean }) {
  const t = await getTranslations({ locale, namespace: 'p5admin.products' });
  const c = await getTranslations({ locale, namespace: 'p5common' });
  const show = (field: string, v: string) => {
    if (!(ENUM_FIELDS as readonly string[]).includes(field)) return v;
    if (field === 'price_mode') return t.has(`diff.priceModes.${v}` as never) ? t(`diff.priceModes.${v}` as never) : v;
    const key =
      field === 'category_slug'
        ? `categories.${v}`
        : field === 'unit'
          ? `units.${v}`
          : field === 'currency'
            ? `currencies.${v}`
            : `availability.${v}`;
    return c.has(key as never) ? c(key as never) : v;
  };
  const cell = (field: string, lines: string[]) =>
    lines.length === 0 ? (
      <span className="muted">{t('diff.notSet')}</span>
    ) : (
      <ul className="adm-lines">
        {lines.map((l, i) => (
          <li key={i}>{show(field, l)}</li>
        ))}
      </ul>
    );
  return (
    <div className="table-wrap">
      <table className="stack adm-diff" data-testid="product-diff">
        <thead>
          <tr>
            <th scope="col">{t('diff.field')}</th>
            <th scope="col">{hasLive ? t('diff.live') : t('diff.noLive')}</th>
            <th scope="col">{t('diff.submitted')}</th>
            <th scope="col">{t('diff.state')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} data-field={r.field} data-changed={r.changed ? 'true' : 'false'}>
              <td data-label={t('diff.field')}>
                <strong>{t(`diff.fields.${r.field}` as never)}</strong>
              </td>
              <td data-label={hasLive ? t('diff.live') : t('diff.noLive')}>{cell(r.field, r.before)}</td>
              <td data-label={t('diff.submitted')}>{cell(r.field, r.after)}</td>
              <td data-label={t('diff.state')}>
                {r.changed ? <span className="chip">{hasLive ? t('diff.changed') : t('diff.new')}</span> : <span className="muted">{t('diff.same')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
