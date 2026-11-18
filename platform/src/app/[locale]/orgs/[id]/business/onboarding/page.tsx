import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import ClaimDocuments from '@/components/ClaimDocuments';
import { Field, SelectField } from '@/components/Field';
import StatusBadge from '@/components/shared/StatusBadge';
import Icon from '@/components/ui/Icon';
import Logo from '@/components/ui/Logo';
import LivePreview from '@/components/workspace/LivePreview';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { BUSINESS_TYPES, CLAIM_TYPES, MY_STATES, REP_ROLES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { findPublishedDuplicates } from '@/server/services/directory';
import { requestMembershipAction } from '../../../join-actions';
import {
  applicableClaims,
  getBusinessPrivate,
  getBusinessProfile,
  getRepresentative,
  listCategories,
  listClaims,
  listDocuments,
} from '@/server/services/verification';
import { saveStep1Action, saveStep2Action, saveStep3Action, saveStep4Action } from '../actions';

const TOTAL = 5;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'biz.openOnboarding');
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const isReview = sp.step === 'review';
  const raw = Number(typeof sp.step === 'string' ? sp.step : '1');
  const step = isReview ? TOTAL : Number.isInteger(raw) && raw >= 1 && raw <= TOTAL ? raw : 1;

  const ctx = await requireBusinessContext(locale, id, isReview ? '/onboarding?step=review' : `/onboarding?step=${step}`);
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });
  const base = `/orgs/${id}/business`;

  if (!ctx.canEdit) {
    return (
      <>
        <h1>{t('biz.openOnboarding')}</h1>
        <p className="message message-error">{t('errors.forbidden')}</p>
        <Link href={base} locale={locale}>
          {t('ob.back')}
        </Link>
      </>
    );
  }

  const [profile, priv, rep, categories] = await Promise.all([getBusinessProfile(db, id), getBusinessPrivate(db, id), getRepresentative(db, id), listCategories(db)]);
  if (!profile && step > 1) redirect(`/${locale}${base}/onboarding?step=1`);
  if (step === 2 && profile && profile.registration_status !== 'registered') redirect(`/${locale}${base}/onboarding?step=3`);

  const back = isReview ? `${base}/onboarding?step=${TOTAL}` : step > 1 ? `${base}/onboarding?step=${step === 3 && profile?.registration_status !== 'registered' ? 1 : step - 1}` : base;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={id} />
    </>
  );
  const secondary = { label: t('ob.later'), value: 'later' };

  let body: React.ReactNode;
  if (isReview) {
    const [claims] = await Promise.all([listClaims(db, id)]);
    const cat0 = categories.find((c) => c.id === profile?.category_id);
    const registered = profile?.registration_status === 'registered';
    const sections: { key: string; title: string; done: boolean; skip?: boolean; lines: string[]; step: number }[] = [
      { key: 'identity', title: t('ob.s1.title'), done: Boolean(profile), step: 1, lines: [profile?.business_name ?? '', cat0 ? catName(locale, cat0) : '', profile ? (registered ? t('ob.s1.yes') : t('ob.s1.no')) : ''].filter(Boolean) },
      { key: 'registration', title: t('ob.s2.title'), done: Boolean(profile?.ssm_number), skip: Boolean(profile) && !registered, step: 2, lines: [profile?.ssm_number ?? '', profile?.business_type ? t(`businessTypes.${profile.business_type}`) : ''].filter(Boolean) },
      { key: 'location', title: t('ob.s3.title'), done: Boolean(profile?.state), step: 3, lines: [[profile?.district, profile?.state].filter(Boolean).join(', '), priv?.address_line ? t('onb2.addressSaved') : ''].filter(Boolean) },
      { key: 'rep', title: t('ob.s4.title'), done: Boolean(rep?.full_name), step: 4, lines: [rep?.full_name ?? '', rep?.role_title ? t(`repRoles.${rep.role_title}`) : ''].filter(Boolean) },
    ];
    body = (
      <>
        <h1>{t('onb2.reviewTitle')}</h1>
        <p style={{ margin: 0 }}>{t('onb2.reviewSub')}</p>
        <ul className="stack-x" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {sections.map((s) => (
            <li key={s.key} className="rrow">
              <div className="rrow-top">
                <h2 style={{ margin: 0, fontSize: '1rem' }}>{s.title}</h2>
                <StatusBadge label={s.skip ? t('onb2.skipped') : s.done ? t('onb2.done') : t('onb2.todo')} tone={s.skip ? 'neutral' : s.done ? 'green' : 'gold'} />
              </div>
              {s.skip ? null : s.lines.length > 0 ? <p className="mut" style={{ margin: 0 }}>{s.lines.join(' · ')}</p> : <p className="mut" style={{ margin: 0 }}>{t('onb2.notAdded')}</p>}
              {s.skip ? null : (
                <div className="rrow-foot">
                  <Link href={`${base}/onboarding?step=${s.step}`} locale={locale} className="btn btn-secondary btn-sm">
                    {t('onb2.edit')}
                    <span className="p5b-sr">: {s.title}</span>
                  </Link>
                </div>
              )}
            </li>
          ))}
          <li className="rrow">
            <div className="rrow-top">
              <h2 style={{ margin: 0, fontSize: '1rem' }}>{t('ob.s5.title')}</h2>
              <StatusBadge label={claims.length ? t('onb2.done') : t('onb2.todo')} tone={claims.length ? 'green' : 'gold'} />
            </div>
            {claims.length > 0 ? (
              <p className="pcard-chips" style={{ margin: 0 }}>
                {claims.map((c) => (
                  <StatusBadge key={c.id} label={`${t(`claimTypes.${c.claim_type}`)}: ${t(`claimStatus.${c.status}`)}`} tone={c.status === 'approved' ? 'green' : c.status === 'rejected' || c.status === 'needs_info' ? 'gold' : 'brand'} />
                ))}
              </p>
            ) : (
              <p className="mut" style={{ margin: 0 }}>{t('onb2.notAdded')}</p>
            )}
            <div className="rrow-foot">
              <Link href={`${base}/onboarding?step=${TOTAL}`} locale={locale} className="btn btn-secondary btn-sm">
                {t('onb2.edit')}
                <span className="p5b-sr">: {t('ob.s5.title')}</span>
              </Link>
              <Link href={`${base}/verification`} locale={locale} className="btn btn-ghost btn-sm">
                {t('biz.openVerification')}
              </Link>
            </div>
          </li>
        </ul>
        <section className="acard" aria-labelledby="ob-next-h">
          <h2 id="ob-next-h" style={{ margin: 0, fontSize: '1.0625rem' }}>
            {t('onb2.listingTitle')}
          </h2>
          <p className="mut" style={{ margin: 0 }}>{t('onb2.listingText')}</p>
          <div>
            <Link href={`${base}/listing`} locale={locale} className="btn btn-primary">
              {t('onb2.listingCta')}
            </Link>
          </div>
        </section>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <h1>{t('ob.s1.title')}</h1>
        <ActionForm action={saveStep1Action} submitLabel={t('ob.next')} secondary={secondary}>
          {hidden}
          <Field id="business_name" name="business_name" label={t('ob.s1.name')} defaultValue={profile?.business_name ?? ctx.org.name} required minLength={2} maxLength={160} />
          <div className="field">
            <label htmlFor="category_slug">{t('ob.s1.category')}</label>
            <select id="category_slug" name="category_slug" required defaultValue={categories.find((c) => c.id === profile?.category_id)?.slug ?? ''}>
              <option value="">{t('ob.s1.categoryChoose')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {catName(locale, c)}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend>{t('ob.s1.registeredLegend')}</legend>
            <div className="opt-grid">
              <label className="opt" htmlFor="reg-yes">
                <input id="reg-yes" type="radio" name="registered" value="yes" defaultChecked={profile?.registration_status === 'registered'} required />
                <strong>{t('ob.s1.yes')}</strong>
              </label>
              <label className="opt" htmlFor="reg-no">
                <input id="reg-no" type="radio" name="registered" value="no" defaultChecked={profile ? profile.registration_status !== 'registered' : false} />
                <strong>{t('ob.s1.no')}</strong>
              </label>
            </div>
          </fieldset>
        </ActionForm>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h1>{t('ob.s2.title')}</h1>
        <p style={{ margin: 0 }}>{t('ob.s2.ssmWhat')}</p>
        <p className="banner" role="note" style={{ margin: 0 }}>
          {t('ob.s2.ssmNotProof')}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          {t('ob.s2.ssmWho')}
        </p>
        <ActionForm action={saveStep2Action} submitLabel={t('ob.next')} secondary={secondary}>
          {hidden}
          <Field id="ssm_number" name="ssm_number" label={t('ob.s2.ssm')} hint={t('ob.s2.ssmHint')} defaultValue={profile?.ssm_number ?? ''} required maxLength={20} />
          <SelectField id="business_type" name="business_type" label={t('ob.s2.type')} defaultValue={profile?.business_type ?? ''}>
            <option value="" disabled>
              {t('ob.s2.typeChoose')}
            </option>
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt} value={bt}>
                {t(`businessTypes.${bt}`)}
              </option>
            ))}
          </SelectField>
        </ActionForm>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <h1>{t('ob.s3.title')}</h1>
        <div className="notice">
          <Icon name="lock" size={18} />
          <span>{t('ob.s3.privacy')}</span>
        </div>
        <ActionForm action={saveStep3Action} submitLabel={t('ob.next')} secondary={secondary}>
          {hidden}
          <SelectField id="state" name="state" label={t('ob.s3.state')} defaultValue={profile?.state ?? ''}>
            <option value="" disabled>
              {t('ob.s3.stateChoose')}
            </option>
            {MY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <Field id="district" name="district" label={t('ob.s3.district')} defaultValue={profile?.district ?? ''} maxLength={80} />
          <Field id="address_line" name="address_line" label={t('ob.s3.address')} defaultValue={priv?.address_line ?? ''} maxLength={200} autoComplete="street-address" />
          <Field id="postcode" name="postcode" label={t('ob.s3.postcode')} defaultValue={priv?.postcode ?? ''} maxLength={5} inputMode="numeric" autoComplete="postal-code" />
        </ActionForm>
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <h1>{t('ob.s4.title')}</h1>
        <p style={{ margin: 0 }}>{t('ob.s4.help')}</p>
        <p className="muted" style={{ margin: 0 }}>{t('ob.s4.note')}</p>
        <ActionForm action={saveStep4Action} submitLabel={t('ob.next')} secondary={secondary}>
          {hidden}
          <Field id="rep_name" name="rep_name" label={t('ob.s4.name')} defaultValue={rep?.full_name ?? ''} required minLength={2} maxLength={120} autoComplete="name" />
          <SelectField id="rep_role" name="rep_role" label={t('ob.s4.role')} defaultValue={rep?.role_title ?? 'owner'}>
            {REP_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`repRoles.${r}`)}
              </option>
            ))}
          </SelectField>
          <Field id="rep_email" name="rep_email" type="email" label={t('ob.s4.email')} defaultValue={rep?.contact_email ?? ''} maxLength={254} />
          <Field id="rep_phone" name="rep_phone" label={t('ob.s4.phone')} defaultValue={rep?.contact_phone ?? ''} maxLength={20} inputMode="text" autoComplete="tel" />
        </ActionForm>
      </>
    );
  } else {
    const [claims, docs] = await Promise.all([listClaims(db, id), listDocuments(db, { orgId: id })]);
    const types = CLAIM_TYPES.filter((ct) => applicableClaims(profile).includes(ct));
    body = (
      <>
        <h1>{t('ob.s5.title')}</h1>
        <p style={{ margin: 0 }}>{t('ob.s5.intro')}</p>
        {types.map((ct) => {
          const claim = claims.find((c) => c.claim_type === ct) ?? null;
          return (
            <ClaimDocuments
              key={ct}
              locale={locale}
              orgId={id}
              claimType={ct}
              claim={claim}
              docs={claim ? docs.filter((d) => d.claim_id === claim.id) : []}
              canSubmit={ctx.canSubmit}
            />
          );
        })}
        <p className="btn-row" style={{ margin: 0 }}>
          <Link href={`${base}/onboarding?step=review`} locale={locale} className="btn btn-primary">
            {t('onb2.toReview')}
          </Link>
          <Link href={`${base}/verification`} locale={locale} className="btn btn-secondary">
            {t('biz.openVerification')}
          </Link>
        </p>
      </>
    );
  }

  // Possible duplicates: only already-published businesses are shown (public information). Never blocks; the person can always continue.
  const dupRes = profile && step >= 2 && step <= 3 ? await findPublishedDuplicates(db, profile.ssm_number ?? null, profile.business_name) : null;
  const dups = dupRes && dupRes.ok ? dupRes.data : [];
  const unregistered = profile ? profile.registration_status !== 'registered' : false;
  const stepDefs = [
    { n: 1, key: '1', title: t('ob.s1.title'), done: Boolean(profile), skip: false, req: t('onb2.req1') },
    { n: 2, key: '2', title: t('ob.s2.title'), done: Boolean(profile?.ssm_number), skip: unregistered, req: t('onb2.req2') },
    { n: 3, key: '3', title: t('ob.s3.title'), done: Boolean(profile?.state), skip: false, req: t('onb2.req3') },
    { n: 4, key: '4', title: t('ob.s4.title'), done: Boolean(rep?.full_name), skip: false, req: t('onb2.req4') },
    { n: 5, key: '5', title: t('ob.s5.title'), done: false, skip: false, req: t('onb2.req5') },
    { n: 6, key: 'review', title: t('onb2.reviewTitle'), done: false, skip: false, req: t('onb2.req6') },
  ];
  const cat = categories.find((c) => c.id === profile?.category_id);

  return (
    <div className="focus-shell">
      <header className="focus-top">
        <div className="focus-top-inner">
          <Logo locale={locale} label={t('ws.homeLabel')} />
          <div className="focus-progress">
            <div className="bar" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step} aria-label={t('ob.progressLabel')}>
              <div style={{ width: `${(step / TOTAL) * 100}%` }} />
            </div>
            <span id="progress-label">{isReview ? t('onb2.reviewStep') : t('ob.stepOf', { n: step, total: TOTAL })}</span>
          </div>
          <Link href={base} locale={locale} className="btn btn-ghost btn-sm">
            {t('onb2.saveExit')}
          </Link>
        </div>
      </header>
      <div className="focus-body">
        <nav aria-label={t('onb2.stepsLabel')} className="focus-steps">
          {stepDefs.map((d) => (
            <Link
              key={d.n}
              href={`${base}/onboarding?step=${d.key}`}
              locale={locale}
              className={`focus-step${d.done ? ' done' : ''}`}
              aria-current={(d.key === 'review' ? isReview : !isReview && d.n === step) ? 'step' : undefined}
            >
              <span className="dot" aria-hidden="true">
                {d.done && d.n !== step ? <Icon name="check" size={14} stroke={3} /> : d.n}
              </span>
              <span>
                <strong>{d.title}</strong>
                <small>
                  {d.key === 'review' ? d.req : `${d.skip ? t('onb2.skipped') : d.done ? t('onb2.done') : t('onb2.todo')} · ${d.req}`}
                </small>
              </span>
            </Link>
          ))}
        </nav>
        <div className="focus-main">
          <div className="focus-card">
            {dups.length > 0 ? (
              <section className="banner" role="note" aria-labelledby="dup-h">
                <h2 id="dup-h" style={{ marginTop: 0, fontSize: '1.0625rem' }}>
                  {t('orgs.dupTitle')}
                </h2>
                <p>{t('orgs.dupBody')}</p>
                {dups.map((d) => (
                  <ActionForm key={d.slug} action={requestMembershipAction} submitLabel={`${t('orgs.dupRequest')}: ${d.name}`} variant="secondary">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="slug" value={d.slug} />
                    <Field id={`dup-msg-${d.slug}`} name="message" label={t('orgs.dupMessage')} maxLength={500} />
                  </ActionForm>
                ))}
                <p className="muted" style={{ marginBottom: 0 }}>
                  {t('orgs.dupContinue')}
                </p>
              </section>
            ) : null}
            {body}
            <p style={{ margin: 0 }}>
              <Link href={back} locale={locale} className="btn btn-secondary">
                {step === 1 ? t('biz.title') : t('ob.back')}
              </Link>
            </p>
          </div>
        </div>
        <aside className="focus-aside" aria-label={t('onb2.previewTitle')}>
          <LivePreview seed={id} initial={{ name: profile?.business_name ?? ctx.org.name, category: cat ? catName(locale, cat) : '', town: profile?.district ?? '' }} />
          <div className="notice">
            <Icon name="info" size={18} />
            <span>{t('onb2.saves')}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
