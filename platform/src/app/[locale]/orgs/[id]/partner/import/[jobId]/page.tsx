import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import PartnerForm from '@/components/partner/PartnerForm';
import PartnerGate from '@/components/partner/PartnerGate';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { importErrorText } from '@/lib/import-errors';
import { pageTitle } from '@/lib/metadata';
import { statusTone } from '@/lib/partner-ui';
import { uuidSchema } from '@/lib/schemas';
import { requirePartnerContext } from '@/server/partner-context';
import { getImport } from '@/server/services/p5-partner';
import type { ImportKind } from '@/server/services/p5-types';
import { cancelImportAction, commitImportAction } from '../actions';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'p5partner.import.previewTitle');
}

const KINDS: ImportKind[] = ['problems', 'valid', 'all'];
const PAGE = 100;

export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id, jobId } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(jobId).success) notFound();
  const ctx = await requirePartnerContext(locale, id, `/import/${jobId}`);
  if (!ctx.approved) return <PartnerGate ctx={ctx} locale={locale} />;
  const show: ImportKind = KINDS.includes(sp.show as ImportKind) ? (sp.show as ImportKind) : 'problems';
  const offset = Math.max(0, Number(typeof sp.offset === 'string' ? sp.offset : 0) || 0);
  const r = await getImport(ctx.session.supabase, id, jobId, show, offset);
  if (!r.ok) notFound();
  const job = r.data;
  const [t, te, tc, tt, fmt] = await Promise.all([
    getTranslations({ locale, namespace: 'p5partner.import' }),
    getTranslations({ locale, namespace: 'errors' }),
    getTranslations({ locale, namespace: 'p5common' }),
    getTranslations({ locale, namespace: 'p5partner.common' }),
    getFormatter({ locale }),
  ]);
  const base = `/orgs/${id}/partner/import`;
  const c = job.counts;
  const problems = c.invalid + c.duplicate;
  const done = job.status === 'committed';
  const q = (k: string) => (typeof sp[k] === 'string' ? Number(sp[k]) : null);
  const created = q('created');
  const updated = q('updated');
  const skipped = q('skipped');
  const when = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  const update = job.mode === 'create_or_update';
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="jobId" value={jobId} />
    </>
  );
  const href = (k: ImportKind, o = 0) => `${base}/${jobId}?show=${k}${o ? `&offset=${o}` : ''}`;
  const shownTotal = show === 'problems' ? problems : show === 'valid' ? c.valid : c.total;

  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {tt('backTo', { page: t('title') })}
        </Link>
      </p>
      <PageHeader title={done ? t('resultTitle') : t('previewTitle')} />
      <p>
        <strong>{job.file_name}</strong> <StatusChip status={statusTone(job.status)} label={tc(`status.import.${job.status}`)} />
        <span className="muted">
          {' '}
          &middot; {update ? t('modeUpdateShort') : t('modeCreateShort')} &middot; {when(job.created_at)}
        </span>
      </p>

      <dl className="dl" data-testid="import-counts">
        <dt>{t('totalRows')}</dt>
        <dd data-testid="count-total">{c.total}</dd>
        <dt>{t('okRows')}</dt>
        <dd data-testid="count-valid">{c.valid}</dd>
        <dt>{t('problemRows')}</dt>
        <dd data-testid="count-invalid">{c.invalid}</dd>
        <dt>{t('repeatedRows')}</dt>
        <dd data-testid="count-duplicate">{c.duplicate}</dd>
      </dl>

      {done ? (
        <section aria-labelledby="done-h" data-testid="import-result">
          <h2 id="done-h">{t('doneTitle')}</h2>
          {sp.repeat === '1' ? <p className="message message-ok">{t('repeatNote')}</p> : null}
          <p>{t('doneBody', { created: created ?? c.valid, updated: updated ?? 0, skipped: skipped ?? problems })}</p>
          <p className="next-step">{t('draftsNote')}</p>
          <p className="link-row">
            <Link href={`/orgs/${id}/partner/products?status=draft${job.supplier_id ? `&supplier=${job.supplier_id}` : ''}`} locale={locale} className="btn btn-primary">
              {t('openDrafts')}
            </Link>
            <Link href={base} locale={locale} className="btn btn-secondary">
              {t('importAnother')}
            </Link>
          </p>
          <p className="hint">{t('submitHint')}</p>
        </section>
      ) : null}

      {job.status === 'failed' ? (
        <p className="message message-error" role="status" data-testid="import-failed">
          {t('failedBody')}
        </p>
      ) : null}
      {job.status === 'cancelled' ? <p className="message message-error">{t('cancelledBody')}</p> : null}

      {job.status === 'previewed' ? (
        <section aria-labelledby="commit-h" data-testid="import-commit">
          <h2 id="commit-h">{t('confirmTitle')}</h2>
          <p>{problems > 0 ? t('confirmWithProblems', { valid: c.valid, problems }) : t('confirmAllGood', { valid: c.valid })}</p>
          {ctx.canManageCatalogue ? (
            <PartnerForm action={commitImportAction} submitLabel={t('confirmButton', { n: c.valid })} reloadHref={`/${locale}${base}/${jobId}`}>
              {hidden}
              {update ? (
                <fieldset data-testid="overwrite-box">
                  <legend>{t('overwriteTitle')}</legend>
                  <p>{t('overwriteBody')}</p>
                  <ul>
                    <li>{t('overwrite1')}</li>
                    <li>{t('overwrite2')}</li>
                    <li>{t('overwrite3')}</li>
                  </ul>
                  <div className="field check">
                    <input id="confirmOverwrite" name="confirmOverwrite" type="checkbox" value="on" />
                    <label htmlFor="confirmOverwrite">{t('overwriteConfirm')}</label>
                  </div>
                </fieldset>
              ) : null}
              <p className="hint">{t('neverPublished')}</p>
            </PartnerForm>
          ) : (
            <p className="message message-error">{t('readOnly')}</p>
          )}
          {ctx.canManageCatalogue ? (
            <PartnerForm action={cancelImportAction} submitLabel={t('cancelButton')} variant="secondary" className="form">
              {hidden}
            </PartnerForm>
          ) : null}
        </section>
      ) : null}

      <h2>{t('rowsTitle')}</h2>
      <nav aria-label={t('rowsFilter')} className="link-row">
        {KINDS.map((k) => (
          <Link key={k} href={href(k)} locale={locale} className={k === show ? 'btn btn-primary' : 'btn btn-secondary'} aria-current={k === show ? 'page' : undefined}>
            {t(`show.${k}`)}
          </Link>
        ))}
        {problems > 0 ? (
          <a className="btn btn-secondary" href={`${base}/${jobId}/rejected`} download data-testid="download-rejected">
            {t('downloadRejected')}
          </a>
        ) : null}
      </nav>
      {job.rows.length === 0 ? (
        <p>{show === 'problems' ? t('noProblems') : t('noRows')}</p>
      ) : (
        <div className="table-wrap">
          <table className="stack" data-testid="import-rows">
            <caption className="visually-hidden">{t('rowsTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('report.row')}</th>
                <th scope="col">{t('report.sku')}</th>
                <th scope="col">{t('report.name')}</th>
                <th scope="col">{t('rowStatus')}</th>
                <th scope="col">{t('report.problems')}</th>
              </tr>
            </thead>
            <tbody>
              {job.rows.map((row) => (
                <tr key={row.row_no} data-testid="import-row" data-row={row.row_no}>
                  <th scope="row" data-label={t('report.row')}>
                    {row.row_no}
                  </th>
                  <td data-label={t('report.sku')}>{row.sku ?? '-'}</td>
                  <td data-label={t('report.name')}>{row.name ?? '-'}</td>
                  <td data-label={t('rowStatus')}>{tc(`status.importRow.${row.status}`)}</td>
                  <td data-label={t('report.problems')}>
                    {row.errors.length === 0 ? (
                      '-'
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
                        {row.errors.map((e, i) => (
                          <li key={i}>{importErrorText(t as never, te as never, e)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shownTotal > PAGE ? (
        <nav aria-label={tt('pagination')} className="link-row">
          {offset > 0 ? (
            <Link href={href(show, Math.max(0, offset - PAGE))} locale={locale} className="btn btn-secondary">
              {tt('previous')}
            </Link>
          ) : null}
          {offset + PAGE < shownTotal ? (
            <Link href={href(show, offset + PAGE)} locale={locale} className="btn btn-secondary">
              {tt('next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
