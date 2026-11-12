import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { SelectField, TextArea } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { REPORT_REASONS, uuidSchema } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { getRequestForSeller } from '@/server/services/directory';
import { listCategories } from '@/server/services/verification';
import { reportAction } from '@/app/[locale]/directory/actions';
import { respondAction } from '../actions';
import { catName } from '@/lib/category';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'inbox.detailTitle');
}

export default async function SellerRequestPage({ params }: { params: Promise<{ locale: string; id: string; requestId: string }> }) {
  const { locale, id, requestId } = await params;
  if (!uuidSchema.safeParse(requestId).success) notFound();
  const ctx = await requireBusinessContext(locale, id, `/requests/${requestId}`);
  const t = await getTranslations({ locale });
  const db = ctx.session.supabase;
  const r = await getRequestForSeller(db, requestId, id);
  if (!r.ok) notFound();
  const v = r.data;
  const categories = await listCategories(db);
  const cat = categories.find((c) => c.slug === v.category_slug);
  const base = `/orgs/${id}/business`;
  const canAnswer = v.match_status === 'invited' && v.request_status === 'open';
  const hidden = (response: string) => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="response" value={response} />
    </>
  );

  return (
    <>
      <p>
        <Link href={`${base}/requests${v.from_board ? '/board' : ''}`} locale={locale}>
          {v.from_board ? t('board.title') : t('inbox.title')}
        </Link>
      </p>
      {v.title ? <h1>{v.title}</h1> : <h1>{t('inbox.detailTitle')}</h1>}
      <p>
        <StatusChip
          status={v.match_status === 'interested' || v.match_status === 'question' ? 'approved' : v.match_status === 'invited' && v.request_status === 'open' ? 'needs_info' : 'none'}
          label={v.request_status !== 'open' && v.match_status === 'invited' ? t('inbox.status.closed') : t(`inbox.status.${v.match_status}`)}
        />
      </p>

      {!v.title ? <p>{t('inbox.noLongerShown')}</p> : null}
      {v.from_board && v.match_status === 'invited' && v.title ? <p className="muted">{t('board.fromBoardNote')}</p> : null}

      {v.title ? (
        <dl className="dl card">
          <dt>{t('req.s1.category')}</dt>
          <dd>{cat ? (catName(locale, cat)) : '-'}</dd>
          <dt>{t('req.s2.state')}</dt>
          <dd>{[v.target_district, v.target_state].filter(Boolean).join(', ') || '-'}</dd>
          <dt>{t('req.s3.quantity')}</dt>
          <dd>{v.quantity ? `${v.quantity} ${v.unit ?? ''}` : '-'}</dd>
          <dt>{t('req.s3.neededBy')}</dt>
          <dd>{v.needed_by ?? '-'}</dd>
          <dt>{t('req.s5.budget')}</dt>
          <dd>{v.budget_min || v.budget_max ? `RM ${v.budget_min ?? '?'} - ${v.budget_max ?? '?'}` : '-'}</dd>
          <dt>{t('req.s4.description')}</dt>
          <dd style={{ whiteSpace: 'pre-line' }}>{v.description}</dd>
          {v.buyer_name ? (
            <>
              <dt>{t('inbox.buyer')}</dt>
              <dd>{v.buyer_name}</dd>
            </>
          ) : null}
          {v.contact_phone || v.contact_email ? (
            <>
              <dt>{t('req.s4.contactTitle')}</dt>
              <dd>{[v.contact_phone, v.contact_email].filter(Boolean).join(' / ')}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {v.title && (v.caution_codes?.length ?? 0) > 0 ? (
        <ul>
          {v.caution_codes?.map((c) => (
            <li key={c}>
              <strong>{t('match.check')}: </strong>
              {t(`match.caution.${c}`)}
            </li>
          ))}
        </ul>
      ) : null}
      {v.title && v.match_status === 'invited' ? <p className="muted">{t('inbox.contactAfterReply')}</p> : null}

      {v.response_note ? (
        <p className="card">
          <strong>{t('inbox.yourReply')}: </strong>
          {v.response_note}
        </p>
      ) : null}
      {v.enquiry_id ? (
        <p>
          <Link href={`/enquiries/${v.enquiry_id}`} locale={locale} className="btn btn-primary">
            {t('match.openEnquiry')}
          </Link>
        </p>
      ) : null}

      {canAnswer ? (
        <section aria-labelledby="ans-h">
          <h2 id="ans-h">{t('inbox.answerTitle')}</h2>
          <p>{t('inbox.answerHint')}</p>
          <ActionForm action={respondAction} submitLabel={t('inbox.interested')}>
            {hidden('interested')}
            <TextArea id="note-i" name="note" label={t('inbox.noteOptional')} maxLength={500} />
          </ActionForm>
          <ActionForm action={respondAction} submitLabel={t('inbox.askQuestion')} variant="secondary">
            {hidden('question')}
            <TextArea id="note-q" name="note" label={t('inbox.questionLabel')} hint={t('inbox.questionHint')} required maxLength={500} />
          </ActionForm>
          <ActionForm action={respondAction} submitLabel={t('inbox.decline')} variant="secondary">
            {hidden('declined')}
            <TextArea id="note-d" name="note" label={t('inbox.declineReason')} maxLength={500} />
          </ActionForm>
        </section>
      ) : null}

      {v.title ? (
        <section aria-labelledby="rep-h">
          <h2 id="rep-h">{t('rep.requestTitle')}</h2>
          <details>
            <summary>{t('rep.open')}</summary>
            <ActionForm action={reportAction} submitLabel={t('rep.send')} variant="secondary">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="type" value="request" />
              <input type="hidden" name="target" value={requestId} />
              <SelectField id="reason" name="reason" label={t('rep.reason')} defaultValue="spam">
                {REPORT_REASONS.map((x) => (
                  <option key={x} value={x}>
                    {t(`rep.reasons.${x}`)}
                  </option>
                ))}
              </SelectField>
              <TextArea id="rnote" name="note" label={t('rep.note')} maxLength={500} />
            </ActionForm>
          </details>
        </section>
      ) : null}
    </>
  );
}
