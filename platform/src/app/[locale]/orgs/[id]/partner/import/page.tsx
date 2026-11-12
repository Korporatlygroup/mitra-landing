import { getFormatter, getTranslations } from 'next-intl/server';
import PartnerForm from '@/components/partner/PartnerForm';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { requirePartnerContext } from '@/server/partner-context';
import { listImports, listMySuppliers } from '@/server/services/p5-partner';
import { stageImportAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.nav.import');
}

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePartnerContext(locale, id, '/import');
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const t = await getTranslations({ locale, namespace: 'p5partner.import' });
  const tc = await getTranslations({ locale, namespace: 'p5common' });
  const tt = await getTranslations({ locale, namespace: 'p5partner.common' });
  const fmt = await getFormatter({ locale });
  const db = ctx.session.supabase;
  const offset = Math.max(0, Number(typeof sp.offset === 'string' ? sp.offset : 0) || 0);
  const [suppliers, history] = await Promise.all([listMySuppliers(db, id), listImports(db, id, null, offset)]);
  const sup = suppliers.ok ? suppliers.data.items : [];
  const approved = sup.filter((s) => s.status === 'approved');
  const nameOf = (sid: string) => sup.find((s) => s.id === sid)?.name ?? '-';
  const base = `/orgs/${id}/partner/import`;
  const jobs = history.ok ? history.data.items : [];
  const total = history.ok ? history.data.total : 0;
  const PAGE = 20;
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      {sp.cancelled ? (
        <p className="message message-ok" role="status">
          {t('cancelled')}
        </p>
      ) : null}

      <section aria-labelledby="imp-1">
        <h2 id="imp-1">{t('step1')}</h2>
        <p>{t('step1Body')}</p>
        <p className="link-row">
          <a className="btn btn-secondary" href={`${base}/template?format=csv`} download>
            {t('downloadCsv')}
          </a>
          <a className="btn btn-secondary" href={`${base}/template?format=xlsx`} download>
            {t('downloadXlsx')}
          </a>
        </p>
        <p className="hint">{t('templateHint')}</p>
      </section>

      <section aria-labelledby="imp-2">
        <h2 id="imp-2">{t('step2')}</h2>
        {!ctx.canManageCatalogue ? (
          <p className="message message-error">{t('readOnly')}</p>
        ) : approved.length === 0 ? (
          <div data-testid="no-approved-supplier">
            <p>{t('needSupplier')}</p>
            <Link href={`/orgs/${id}/partner/suppliers`} locale={locale} className="btn btn-primary">
              {t('goSuppliers')}
            </Link>
          </div>
        ) : (
          <PartnerForm action={stageImportAction} submitLabel={t('upload')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="orgId" value={id} />
            <div className="field">
              <label htmlFor="supplierId">{t('supplier')}</label>
              <p id="supplier-hint" className="hint">
                {t('supplierHint')}
              </p>
              <select id="supplierId" name="supplierId" required aria-describedby="supplier-hint">
                {approved.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.code} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend>{t('modeLegend')}</legend>
              <div className="radio">
                <input id="mode-create" type="radio" name="mode" value="create_only" defaultChecked />
                <label htmlFor="mode-create">{t('modeCreate')}</label>
              </div>
              <p className="hint" style={{ margin: '0 0 8px 36px' }}>
                {t('modeCreateHint')}
              </p>
              <div className="radio">
                <input id="mode-update" type="radio" name="mode" value="create_or_update" />
                <label htmlFor="mode-update">{t('modeUpdate')}</label>
              </div>
              <p className="hint" style={{ margin: '0 0 8px 36px' }}>
                {t('modeUpdateHint')}
              </p>
            </fieldset>
            <div className="field">
              <label htmlFor="file">{t('fileLabel')}</label>
              <p id="file-hint" className="hint">
                {t('fileHint')}
              </p>
              <input id="file" name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required aria-describedby="file-hint" />
            </div>
          </PartnerForm>
        )}
      </section>

      <section aria-labelledby="imp-h">
        <h2 id="imp-h">{t('historyTitle')}</h2>
        {!history.ok ? null : jobs.length === 0 ? (
          <p>{t('historyNone')}</p>
        ) : (
          <ul className="card-list" data-testid="import-history">
            {jobs.map((j) => (
              <li key={j.id} className="card" data-testid="import-job">
                <p style={{ margin: 0 }}>
                  <Link href={`${base}/${j.id}`} locale={locale}>
                    <strong>{j.file_name}</strong>
                  </Link>
                </p>
                <p style={{ margin: '4px 0' }}>
                  <StatusChip status={statusTone(j.status)} label={tc(`status.import.${j.status}`)} />
                  <span className="muted">
                    {' '}
                    &middot; {nameOf(j.supplier_id)} &middot; {when(j.created_at)}
                  </span>
                </p>
                <p className="hint" style={{ margin: 0 }}>
                  {t('countsLine', { total: j.counts.total, valid: j.counts.valid, invalid: j.counts.invalid, duplicate: j.counts.duplicate })}
                </p>
              </li>
            ))}
          </ul>
        )}
        {total > PAGE ? (
          <nav aria-label={tt('pagination')} className="link-row">
            {offset > 0 ? (
              <Link href={`${base}?offset=${Math.max(0, offset - PAGE)}`} locale={locale} className="btn btn-secondary">
                {tt('previous')}
              </Link>
            ) : null}
            {offset + PAGE < total ? (
              <Link href={`${base}?offset=${offset + PAGE}`} locale={locale} className="btn btn-secondary">
                {tt('next')}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
