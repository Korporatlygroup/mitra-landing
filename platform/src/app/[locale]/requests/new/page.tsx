import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { Field, SelectField } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { pageTitle } from '@/lib/metadata';
import { MY_STATES, uuidSchema } from '@/lib/schemas';
import { getBuyerRequest, getRequestContact } from '@/server/services/directory';
import { requireSession } from '@/server/session';
import { listCategories } from '@/server/services/verification';
import { saveRequestStepAction, submitRequestAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'req.wizardTitle');
}

const TOTAL = 5;

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const idParam = typeof sp.id === 'string' ? sp.id : undefined;
  const id = idParam && uuidSchema.safeParse(idParam).success ? idParam : undefined;
  const rawStep = Number(typeof sp.step === 'string' ? sp.step : '1');
  const step = Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= TOTAL ? rawStep : 1;

  const session = await requireSession({ locale, path: `/requests/new?step=${step}${id ? `&id=${id}` : ''}` });
  const t = await getTranslations({ locale });
  const db = session.supabase;

  const request = id ? await getBuyerRequest(db, id) : null;
  if (id && !request) notFound();
  if (request && request.status !== 'draft') redirect(`/${locale}/requests/${request.id}`);
  if (!request && step > 1) redirect(`/${locale}/requests/new?step=1`);

  const base = `/requests/new?id=${id ?? ''}`;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="key" value={randomUUID()} />
      {request ? <input type="hidden" name="requestId" value={request.id} /> : null}
      <input type="hidden" name="expectedVersion" value={request?.version ?? 0} />
    </>
  );
  const later = { label: t('req.later'), value: 'later' };
  const header = (
    <>
      <p id="progress-label">
        <strong>{t('ob.stepOf', { n: step, total: TOTAL })}</strong>
      </p>
      <progress max={TOTAL} value={step} aria-labelledby="progress-label" aria-label={t('ob.progressLabel')} />
    </>
  );
  const back = step === 1 ? '/requests' : `${base}&step=${step - 1}`;

  let body: React.ReactNode;
  if (step === 1) {
    const categories = await listCategories(db);
    const orgs = eligibleBuyerOrgs(session.memberships);
    body = (
      <>
        <h1>{t('req.s1.title')}</h1>
        <ActionForm action={saveRequestStepAction} submitLabel={t('ob.next')} secondary={later}>
          {hidden}
          {!request && orgs.length > 1 ? (
            <SelectField id="orgId" name="orgId" label={t('req.s1.org')} defaultValue={orgs[0].org.id}>
              {orgs.map((m) => (
                <option key={m.org.id} value={m.org.id}>
                  {m.org.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <Field id="title" name="title" label={t('req.s1.what')} hint={t('req.s1.whatHint')} defaultValue={request?.title ?? ''} required minLength={5} maxLength={140} />
          <div className="field">
            <label htmlFor="category_slug">{t('req.s1.category')}</label>
            <select id="category_slug" name="category_slug" required defaultValue={categories.find((c) => c.id === request?.category_id)?.slug ?? ''}>
              <option value="">{t('ob.s1.categoryChoose')}</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {locale === 'ta' ? c.name_ta : c.name_en}
                </option>
              ))}
            </select>
          </div>
        </ActionForm>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h1>{t('req.s2.title')}</h1>
        <ActionForm action={saveRequestStepAction} submitLabel={t('ob.next')} secondary={later}>
          {hidden}
          <SelectField id="target_state" name="target_state" label={t('req.s2.state')} defaultValue={request?.target_state ?? ''}>
            <option value="" disabled>
              {t('ob.s3.stateChoose')}
            </option>
            {MY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <Field id="target_district" name="target_district" label={t('req.s2.district')} hint={t('req.s2.districtHint')} defaultValue={request?.target_district ?? ''} maxLength={80} />
        </ActionForm>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <h1>{t('req.s3.title')}</h1>
        <p>{t('req.s3.optional')}</p>
        <ActionForm action={saveRequestStepAction} submitLabel={t('ob.next')} secondary={later}>
          {hidden}
          <Field id="quantity" name="quantity" label={t('req.s3.quantity')} hint={t('req.s3.quantityHint')} defaultValue={request?.quantity?.toString() ?? ''} inputMode="numeric" maxLength={14} />
          <Field id="unit" name="unit" label={t('req.s3.unit')} hint={t('req.s3.unitHint')} defaultValue={request?.unit ?? ''} maxLength={30} />
          <div className="field">
            <label htmlFor="needed_by">{t('req.s3.neededBy')}</label>
            <p className="hint" id="needed_by-hint">
              {t('req.s3.neededByHint')}
            </p>
            <input id="needed_by" name="needed_by" type="date" defaultValue={request?.needed_by ?? ''} aria-describedby="needed_by-hint" />
          </div>
          <Field id="budget_min" name="budget_min" label={t('req.s3.budgetMin')} defaultValue={request?.budget_min?.toString() ?? ''} inputMode="numeric" maxLength={15} />
          <Field id="budget_max" name="budget_max" label={t('req.s3.budgetMax')} defaultValue={request?.budget_max?.toString() ?? ''} inputMode="numeric" maxLength={15} />
        </ActionForm>
      </>
    );
  } else if (step === 4) {
    const contact = request ? await getRequestContact(db, request.id) : null;
    body = (
      <>
        <h1>{t('req.s4.title')}</h1>
        <ActionForm action={saveRequestStepAction} submitLabel={t('ob.next')} secondary={later}>
          {hidden}
          <div className="field">
            <label htmlFor="description">{t('req.s4.description')}</label>
            <p className="hint" id="description-hint">
              {t('req.s4.descriptionHint')}
            </p>
            <textarea id="description" name="description" rows={6} required minLength={20} maxLength={2000} defaultValue={request?.description ?? ''} aria-describedby="description-hint" />
          </div>
          <fieldset>
            <legend>{t('req.s4.contactTitle')}</legend>
            <p className="hint">{t('req.s4.contactHint')}</p>
            <Field id="contact_phone" name="contact_phone" label={t('req.s4.phone')} defaultValue={contact?.contact_phone ?? ''} maxLength={20} autoComplete="tel" />
            <Field id="contact_email" name="contact_email" type="email" label={t('req.s4.email')} defaultValue={contact?.contact_email ?? ''} maxLength={254} autoComplete="email" />
            <div className="field check">
              <input id="share_contact" name="share_contact" type="checkbox" defaultChecked={request?.share_contact ?? false} />
              <label htmlFor="share_contact">{t('req.s4.share')}</label>
            </div>
            <p className="hint">{t('req.s4.shareHint')}</p>
          </fieldset>
        </ActionForm>
      </>
    );
  } else {
    const contact = request ? await getRequestContact(db, request.id) : null;
    const categories = await listCategories(db);
    const cat = categories.find((c) => c.id === request?.category_id);
    const edit = (n: number) => (
      <Link href={`${base}&step=${n}`} locale={locale}>
        {t('req.change')}
      </Link>
    );
    body = (
      <>
        <h1>{t('req.s5.title')}</h1>
        <p>{t('req.s5.intro')}</p>
        {request ? (
          <dl className="dl card">
            <dt>{t('req.s1.what')}</dt>
            <dd>
              {request.title} {edit(1)}
            </dd>
            <dt>{t('req.s1.category')}</dt>
            <dd>{cat ? (locale === 'ta' ? cat.name_ta : cat.name_en) : '-'}</dd>
            <dt>{t('req.s2.state')}</dt>
            <dd>
              {[request.target_district, request.target_state].filter(Boolean).join(', ') || '-'} {edit(2)}
            </dd>
            <dt>{t('req.s3.quantity')}</dt>
            <dd>
              {request.quantity ? `${request.quantity} ${request.unit ?? ''}` : '-'} {edit(3)}
            </dd>
            <dt>{t('req.s3.neededBy')}</dt>
            <dd>{request.needed_by ?? '-'}</dd>
            <dt>{t('req.s5.budget')}</dt>
            <dd>{request.budget_min || request.budget_max ? `RM ${request.budget_min ?? '?'} - ${request.budget_max ?? '?'}` : '-'}</dd>
            <dt>{t('req.s4.description')}</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>
              {request.description ?? '-'} {edit(4)}
            </dd>
            <dt>{t('req.s4.contactTitle')}</dt>
            <dd>{[contact?.contact_phone, contact?.contact_email].filter(Boolean).join(' / ') || '-'}</dd>
            <dt>{t('req.s5.sharing')}</dt>
            <dd>{request.share_contact ? t('req.s5.shared') : t('req.s5.notShared')}</dd>
          </dl>
        ) : null}
        <p className="muted">{t('req.s5.note')}</p>
        {request ? (
          <ActionForm action={submitRequestAction} submitLabel={t('req.s5.send')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="expectedVersion" value={request.version} />
          </ActionForm>
        ) : null}
      </>
    );
  }

  return (
    <>
      {header}
      {body}
      <p>
        <Link href={back} locale={locale}>
          {step === 1 ? t('req.title') : t('ob.back')}
        </Link>
      </p>
    </>
  );
}
