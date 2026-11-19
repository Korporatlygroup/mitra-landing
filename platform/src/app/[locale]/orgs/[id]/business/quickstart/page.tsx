import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { Field, SelectField } from '@/components/Field';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { MY_STATES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { getOwnerListing } from '@/server/services/directory';
import { getBusinessProfile, listCategories } from '@/server/services/verification';
import { quickStep1Action, quickStep2Action, quickStep3Action } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'deals.quick.title');
}

/** List your business in three short steps (name and category, where, what you offer), then send it for INOK review. */
export default async function QuickStartPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const isDone = sp.step === 'done';
  const raw = Number(sp.step ?? '1');
  const step = isDone ? 4 : Number.isInteger(raw) && raw >= 1 && raw <= 3 ? raw : 1;
  const ctx = await requireBusinessContext(locale, id, `/quickstart?step=${isDone ? 'done' : step}`);
  const t = await getTranslations({ locale });
  const d = await getTranslations({ locale, namespace: 'deals' });
  const base = `/orgs/${id}/business`;
  if (!ctx.canEdit) return <p className="message message-error">{t('errors.forbidden')}</p>;
  const db = ctx.session.supabase;
  const [profile, categories, listing] = await Promise.all([getBusinessProfile(db, id), listCategories(db), getOwnerListing(db, id)]);
  if (step > 1 && step < 4 && !profile) redirect(`/${locale}${base}/quickstart?step=1`);
  if (step === 3 && !profile?.state) redirect(`/${locale}${base}/quickstart?step=2`);
  const hidden = (<><input type="hidden" name="locale" value={locale} /><input type="hidden" name="orgId" value={id} /></>);
  const draft = listing?.draft;
  const hasServices = (draft?.services?.length ?? 0) > 0;

  if (step === 4) {
    return (
      <div className="quick">
        <h1>{d('quick.doneTitle')}</h1>
        <p>{d('quick.doneText')}</p>
        <section className="card" aria-labelledby="qs-next">
          <h2 id="qs-next">{d('quick.nextSteps')}</h2>
          <p className="mut">{d('quick.nextStepsText')}</p>
          <ul className="deal-timeline">
            <li><Link href={`${base}/onboarding?step=2`}>{d('quick.nsRegistration')}</Link></li>
            <li><Link href={`${base}/onboarding?step=3`}>{d('quick.nsAddress')}</Link></li>
            <li><Link href={`${base}/onboarding?step=4`}>{d('quick.nsPerson')}</Link></li>
            <li><Link href={`${base}/onboarding?step=5`}>{d('quick.nsDocuments')}</Link></li>
          </ul>
        </section>
        <p><Link href="/" className="btn btn-primary">{d('quick.goHome')}</Link></p>
      </div>
    );
  }

  return (
    <div className="quick">
      <p className="mut" aria-live="polite">{d('quick.stepOf', { n: step })}</p>
      <div className="quick-bar" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label={d('quick.title')}><span style={{ width: `${(step / 3) * 100}%` }} /></div>
      {step === 1 ? (
        <>
          <h1>{d('quick.s1Title')}</h1>
          <ActionForm action={quickStep1Action} submitLabel={d('quick.next')}>
            {hidden}
            <Field id="business_name" name="business_name" label={t('ob.s1.name')} defaultValue={profile?.business_name ?? ctx.org.name} required minLength={2} maxLength={160} />
            <div className="field">
              <label htmlFor="category_slug">{t('ob.s1.category')}</label>
              <select id="category_slug" name="category_slug" required defaultValue={categories.find((c) => c.id === profile?.category_id)?.slug ?? ''}>
                <option value="">{t('ob.s1.categoryChoose')}</option>
                {categories.map((c) => <option key={c.id} value={c.slug}>{catName(locale, c)}</option>)}
              </select>
            </div>
            <fieldset>
              <legend>{t('ob.s1.registeredLegend')}</legend>
              <div className="opt-grid">
                <label className="opt" htmlFor="reg-yes"><input id="reg-yes" type="radio" name="registered" value="yes" defaultChecked={profile?.registration_status === 'registered'} required /><strong>{t('ob.s1.yes')}</strong></label>
                <label className="opt" htmlFor="reg-no"><input id="reg-no" type="radio" name="registered" value="no" defaultChecked={profile ? profile.registration_status !== 'registered' : false} /><strong>{t('ob.s1.no')}</strong></label>
              </div>
            </fieldset>
          </ActionForm>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h1>{d('quick.s2Title')}</h1>
          <p className="mut">{d('quick.s2Help')}</p>
          <ActionForm action={quickStep2Action} submitLabel={d('quick.next')}>
            {hidden}
            <SelectField id="state" name="state" label={t('ob.s3.state')} defaultValue={profile?.state ?? ''}>
              <option value="" disabled>{t('ob.s3.stateChoose')}</option>
              {MY_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </SelectField>
            <Field id="district" name="district" label={t('ob.s3.district')} defaultValue={profile?.district ?? ''} maxLength={80} />
          </ActionForm>
          <p><Link href={`${base}/quickstart?step=1`} className="btn btn-secondary">{d('quick.back')}</Link></p>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <h1>{d('quick.s3Title')}</h1>
          <p className="mut">{d('quick.s3Help')}</p>
          <ActionForm action={quickStep3Action} submitLabel={d('quick.send')}>
            {hidden}
            <Field id="headline" name="headline" label={d('quick.headline')} defaultValue={draft?.headline ?? ''} required minLength={10} maxLength={120} />
            <div className="field">
              <label htmlFor="description">{d('quick.description')}</label>
              <textarea id="description" name="description" required minLength={30} maxLength={2000} rows={4} defaultValue={draft?.description ?? ''} />
            </div>
            {hasServices ? null : (
              <>
                <Field id="service_name" name="service_name" label={d('quick.service')} required minLength={2} maxLength={120} />
                <fieldset>
                  <legend>{d('quick.coverage')}</legend>
                  <div className="opt-grid">
                    <label className="opt" htmlFor="cov-state"><input id="cov-state" type="radio" name="coverage" value="state" defaultChecked /><strong>{d('quick.coverageState')}</strong></label>
                    <label className="opt" htmlFor="cov-all"><input id="cov-all" type="radio" name="coverage" value="all" /><strong>{d('quick.coverageAll')}</strong></label>
                  </div>
                </fieldset>
              </>
            )}
            {hasServices ? <input type="hidden" name="coverage" value="state" /> : null}
            <Field id="whatsapp" name="whatsapp" label={d('quick.whatsapp')} hint={d('quick.whatsappHint')} inputMode="numeric" maxLength={30} defaultValue={(draft as { links?: { whatsapp?: string | null } } | undefined)?.links?.whatsapp ?? ''} />
            <p className="mut">{d('quick.reviewNote')}</p>
          </ActionForm>
          <p><Link href={`${base}/quickstart?step=2`} className="btn btn-secondary">{d('quick.back')}</Link></p>
        </>
      ) : null}
    </div>
  );
}
