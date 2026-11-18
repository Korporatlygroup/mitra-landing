import { getTranslations } from 'next-intl/server';
import ActionForm from '@/components/ActionForm';
import { Field, SelectField } from '@/components/Field';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { MY_STATES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { getOwnerListing, listListingEvents, type DraftService } from '@/server/services/directory';
import { getBusinessProfile, listCategories } from '@/server/services/verification';
import {
  acceptingAction,
  republishListingAction,
  saveListingAction,
  submitListingAction,
  unpublishListingAction,
  withdrawListingAction,
} from './actions';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'listing.title');
}

const MAX_SERVICES = 10;
const MAX_PORTFOLIO = 8;

export default async function ListingEditorPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const ctx = await requireBusinessContext(locale, id, '/listing');
  const db = ctx.session.supabase;
  const t = await getTranslations({ locale });
  const base = `/orgs/${id}/business`;
  const canPublish = ctx.perms.has('listing:publish');

  const [profile, listing, categories, events] = await Promise.all([
    getBusinessProfile(db, id),
    getOwnerListing(db, id),
    listCategories(db),
    listListingEvents(db, id, 5),
  ]);

  if (!profile) {
    return (
      <>
        <PageHeader title={t('listing.title')} sub={t('listing.needProfile')} />
        <EmptyState icon="store" title={t('biz.notStarted')} text={t('listing.needProfile')} action={{ href: `${base}/onboarding?step=1`, label: t('biz.next.start') }} />
      </>
    );
  }

  const draft = listing?.draft ?? {};
  const version = listing?.draft_version ?? 0;
  const review = listing?.review_status ?? 'editing';
  const live = listing?.live_status ?? 'unpublished';
  const pending = review === 'pending_review';
  const services: DraftService[] = draft.services ?? [];
  const portfolio = draft.portfolio ?? [];
  const serviceRows = Math.min(MAX_SERVICES, services.length + 1);
  const portfolioRows = Math.min(MAX_PORTFOLIO, portfolio.length + 1);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orgId" value={id} />
    </>
  );
  const note = listing?.review_reason;

  return (
    <>
      <p>
        <Link href={base} locale={locale}>
          {t('listing.back')}
        </Link>
      </p>
      <PageHeader title={t('listing.title')} sub={t('listing.intro')} />

      <section aria-labelledby="st-h" className="card">
        <h2 id="st-h" style={{ marginTop: 0 }}>
          {t('listing.statusTitle')}
        </h2>
        <p>
          {t('listing.publicNow')}: <StatusChip status={live === 'published' ? 'approved' : live === 'suspended' ? 'rejected' : 'none'} label={t(`listing.live.${live}`)} />
        </p>
        <p>
          {t('listing.yourEdits')}: <StatusChip status={review === 'rejected' || review === 'changes_requested' ? 'needs_info' : review === 'approved' ? 'approved' : 'none'} label={t(`listing.review.${review}`)} />
        </p>
        {live === 'suspended' && listing?.suspended_reason ? (
          <p role="note" className="banner">
            {t('listing.suspendedNote')} {listing.suspended_reason}
          </p>
        ) : null}
        {note && review !== 'approved' ? (
          <p role="note" className="banner">
            <strong>{t('listing.reviewerNote')}: </strong>
            {note}
          </p>
        ) : null}
        {(listing?.live_version ?? 0) > 0 && review !== 'approved' ? <p className="muted">{t('listing.liveKept')}</p> : null}
        <p className="link-row">
          <Link href={`${base}/listing/preview`} locale={locale} className="btn btn-secondary">
            {t('listing.preview')}
          </Link>
          {live === 'published' && listing?.slug ? (
            <Link href={`/directory/${listing.slug}`} locale={locale}>
              {t('listing.viewPublic')}
            </Link>
          ) : null}
        </p>
      </section>

      {pending ? (
        <section aria-labelledby="pend-h">
          <h2 id="pend-h">{t('listing.pendingTitle')}</h2>
          <p>{t('listing.pendingBody')}</p>
          {canPublish ? (
            <ActionForm action={withdrawListingAction} submitLabel={t('listing.withdraw')} variant="secondary">
              {hidden}
            </ActionForm>
          ) : null}
        </section>
      ) : (
        <ActionForm action={saveListingAction} submitLabel={t('listing.save')}>
          {hidden}
          <input type="hidden" name="expectedVersion" value={version} />
          <Field id="headline" name="headline" label={t('listing.headline')} hint={t('listing.headlineHint')} defaultValue={draft.headline ?? ''} maxLength={160} />
          <div className="field">
            <label htmlFor="description">{t('listing.description')}</label>
            <p className="hint" id="description-hint">
              {t('listing.descriptionHint')}
            </p>
            <textarea id="description" name="description" rows={5} maxLength={2000} defaultValue={draft.description ?? ''} aria-describedby="description-hint" />
          </div>

          <fieldset>
            <legend>{t('listing.contactTitle')}</legend>
            <p className="hint">{t('listing.contactHint')}</p>
            <div className="field check">
              <input id="show_phone" name="show_phone" type="checkbox" defaultChecked={Boolean(draft.show_phone)} />
              <label htmlFor="show_phone">{t('listing.showPhone')}</label>
            </div>
            <Field id="public_phone" name="public_phone" label={t('listing.publicPhone')} defaultValue={draft.public_phone ?? ''} maxLength={20} inputMode="text" autoComplete="tel" />
            <div className="field check">
              <input id="show_email" name="show_email" type="checkbox" defaultChecked={Boolean(draft.show_email)} />
              <label htmlFor="show_email">{t('listing.showEmail')}</label>
            </div>
            <Field id="public_email" name="public_email" type="email" label={t('listing.publicEmail')} defaultValue={draft.public_email ?? ''} maxLength={254} />
          </fieldset>

          <fieldset>
            <legend>{t('listing.linksTitle')}</legend>
            <p className="hint">{t('listing.linksHint')}</p>
            <Field id="link_whatsapp" name="link_whatsapp" label={t('listing.linkWhatsapp')} defaultValue={draft.links?.whatsapp ?? ''} maxLength={30} autoComplete="off" />
            <Field id="link_website" name="link_website" label={t('listing.linkWebsite')} defaultValue={draft.links?.website ?? ''} maxLength={300} autoComplete="url" />
            <Field id="link_facebook" name="link_facebook" label={t('listing.linkFacebook')} defaultValue={draft.links?.facebook ?? ''} maxLength={300} autoComplete="off" />
            <Field id="link_instagram" name="link_instagram" label={t('listing.linkInstagram')} defaultValue={draft.links?.instagram ?? ''} maxLength={300} autoComplete="off" />
            <Field id="link_tiktok" name="link_tiktok" label={t('listing.linkTiktok')} defaultValue={draft.links?.tiktok ?? ''} maxLength={300} autoComplete="off" />
            <Field id="link_linkedin" name="link_linkedin" label={t('listing.linkLinkedin')} defaultValue={draft.links?.linkedin ?? ''} maxLength={300} autoComplete="off" />
            <Field id="link_youtube" name="link_youtube" label={t('listing.linkYoutube')} defaultValue={draft.links?.youtube ?? ''} maxLength={300} autoComplete="off" />
            <Field id="link_google_maps" name="link_google_maps" label={t('listing.linkMaps')} defaultValue={draft.links?.google_maps ?? ''} maxLength={300} autoComplete="off" />
            <Field id="hours" name="hours" label={t('listing.hoursLabel')} hint={t('listing.hoursHint')} defaultValue={draft.hours ?? ''} maxLength={300} />
          </fieldset>

          <h2>{t('listing.servicesTitle')}</h2>
          <p>{t('listing.servicesHint')}</p>
          {Array.from({ length: serviceRows }, (_, i) => {
            const s = services[i];
            return (
              <fieldset key={i}>
                <legend>{t('listing.serviceN', { n: i + 1 })}</legend>
                <Field id={`svc_name_${i}`} name={`svc_name_${i}`} label={t('listing.svcName')} hint={t('listing.svcNameHint')} defaultValue={s?.name ?? ''} maxLength={120} />
                <SelectField id={`svc_cat_${i}`} name={`svc_cat_${i}`} label={t('listing.svcCategory')} defaultValue={s?.category_slug ?? categories.find((c) => c.id === profile.category_id)?.slug ?? ''}>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {catName(locale, c)}
                    </option>
                  ))}
                </SelectField>
                <div className="field">
                  <label htmlFor={`svc_desc_${i}`}>{t('listing.svcDescription')}</label>
                  <textarea id={`svc_desc_${i}`} name={`svc_desc_${i}`} rows={3} maxLength={600} defaultValue={s?.description ?? ''} />
                </div>
                <fieldset>
                  <legend>{t('listing.svcAreas')}</legend>
                  <div className="field check">
                    <input id={`svc_nat_${i}`} name={`svc_nat_${i}`} type="checkbox" defaultChecked={Boolean(s?.nationwide)} />
                    <label htmlFor={`svc_nat_${i}`}>{t('dir.allMalaysia')}</label>
                  </div>
                  {MY_STATES.map((st) => (
                    <div className="field check" key={st}>
                      <input id={`svc_areas_${i}_${st}`} name={`svc_areas_${i}`} value={st} type="checkbox" defaultChecked={s?.areas?.includes(st) ?? (i === 0 && !s && st === profile.state)} />
                      <label htmlFor={`svc_areas_${i}_${st}`}>{st}</label>
                    </div>
                  ))}
                </fieldset>
                <details>
                  <summary>{t('listing.svcMore')}</summary>
                  <Field id={`svc_minqty_${i}`} name={`svc_minqty_${i}`} label={t('listing.svcMinQty')} hint={t('listing.svcMinQtyHint')} defaultValue={s?.min_order_qty?.toString() ?? ''} inputMode="numeric" maxLength={14} />
                  <Field id={`svc_unit_${i}`} name={`svc_unit_${i}`} label={t('listing.svcUnit')} defaultValue={s?.min_order_unit ?? ''} maxLength={30} />
                  <Field id={`svc_lead_${i}`} name={`svc_lead_${i}`} label={t('listing.svcLead')} defaultValue={s?.lead_time_days?.toString() ?? ''} inputMode="numeric" maxLength={3} />
                  <Field id={`svc_cap_${i}`} name={`svc_cap_${i}`} label={t('listing.svcCapacity')} hint={t('listing.svcCapacityHint')} defaultValue={s?.capacity_note ?? ''} maxLength={300} />
                </details>
              </fieldset>
            );
          })}

          <h2>{t('listing.portfolioTitle')}</h2>
          <p>{t('listing.portfolioHint')}</p>
          {portfolio.length === 0 ? <p className="muted">{t('listing.portfolioEmpty')}</p> : <p className="muted">{t('listing.pfRemoveHint')}</p>}
          <p className="muted">{t('listing.portfolioImagesLater')}</p>
          {Array.from({ length: portfolioRows }, (_, i) => (
            <fieldset key={i}>
              <legend>{t('listing.exampleN', { n: i + 1 })}</legend>
              <Field id={`pf_title_${i}`} name={`pf_title_${i}`} label={t('listing.pfTitle')} defaultValue={portfolio[i]?.title ?? ''} maxLength={120} />
              <SelectField id={`pf_cat_${i}`} name={`pf_cat_${i}`} label={t('listing.pfCategory')} defaultValue={portfolio[i]?.category_slug ?? ''}>
                <option value="">{t('listing.pfNoCategory')}</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {catName(locale, c)}
                  </option>
                ))}
              </SelectField>
              <div className="field">
                <label htmlFor={`pf_date_${i}`}>{t('listing.pfDate')}</label>
                <input id={`pf_date_${i}`} name={`pf_date_${i}`} type="month" max={new Date().toISOString().slice(0, 7)} defaultValue={portfolio[i]?.project_date?.slice(0, 7) ?? ''} />
              </div>
              <div className="field">
                <label htmlFor={`pf_desc_${i}`}>{t('listing.pfDescription')}</label>
                <textarea id={`pf_desc_${i}`} name={`pf_desc_${i}`} rows={2} maxLength={600} defaultValue={portfolio[i]?.description ?? ''} />
              </div>
            </fieldset>
          ))}
        </ActionForm>
      )}

      {!pending && listing && canPublish && review !== 'approved' ? (
        <section aria-labelledby="send-h">
          <h2 id="send-h">{t('listing.sendTitle')}</h2>
          <p>{t('listing.sendBody')}</p>
          <ActionForm action={submitListingAction} submitLabel={t('listing.send')}>
            {hidden}
            <input type="hidden" name="expectedVersion" value={version} />
          </ActionForm>
        </section>
      ) : null}
      {!canPublish ? <p className="muted">{t('listing.noPublishRight')}</p> : null}

      {listing ? (
        <section aria-labelledby="vis-h">
          <h2 id="vis-h">{t('listing.visibilityTitle')}</h2>
          <ActionForm action={acceptingAction} submitLabel={listing.accepting_requests ? t('listing.setBusy') : t('listing.setOpen')} variant="secondary">
            {hidden}
            <input type="hidden" name="value" value={listing.accepting_requests ? 'false' : 'true'} />
            <p>{listing.accepting_requests ? t('listing.acceptingNow') : t('listing.busyNow')}</p>
          </ActionForm>
          {canPublish && live === 'published' ? (
            <ActionForm action={unpublishListingAction} submitLabel={t('listing.unpublish')} variant="secondary">
              {hidden}
            </ActionForm>
          ) : null}
          {canPublish && live === 'unpublished' && (listing.live_version ?? 0) > 0 ? (
            <ActionForm action={republishListingAction} submitLabel={t('listing.republish')}>
              {hidden}
            </ActionForm>
          ) : null}
        </section>
      ) : null}

      {events.length > 0 ? (
        <section aria-labelledby="hist-h">
          <h2 id="hist-h">{t('listing.historyTitle')}</h2>
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                {t(`listing.events.${e.event}`)}
                {e.details?.reason ? `: ${e.details.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
