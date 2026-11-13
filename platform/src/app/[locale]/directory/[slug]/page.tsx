import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { Field, SelectField, TextArea } from '@/components/Field';
import ListingView from '@/components/ListingView';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { REPORT_REASONS } from '@/lib/schemas';
import { getListing } from '@/server/services/directory';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';
import { reportAction, sendEnquiryAction } from '../actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { supabase } = await getOptionalUser();
  const r = supabase ? await getListing(supabase, slug) : null;
  const t = await getTranslations({ locale, namespace: 'dir' });
  return { title: r?.ok ? r.data.name : t('title') };
}

export default async function ListingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale });
  const { supabase, user } = await getOptionalUser();
  if (!supabase) notFound();
  const r = await getListing(supabase, slug);
  if (!r.ok) notFound();
  const b = r.data;
  const { data: publishedReviews } = await supabase.rpc('list_published_business_reviews', { p_slug: slug });

  const memberships = user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleBuyerOrgs(memberships);
  const next = encodeURIComponent(`/${locale}/directory/${slug}`);

  return (
    <>
      <p>
        <Link href="/directory" locale={locale}>
          {t('dir.backToResults')}
        </Link>
      </p>
      <ListingView data={b} locale={locale} />
      {(publishedReviews?.length ?? 0) > 0 ? <section aria-labelledby="reviews-h" className="card">
        <h2 id="reviews-h">{t('p4.publishedReviews')}</h2>
        <ul>{publishedReviews!.map((review: { rating: number; review_text: string; seller_response: string | null; created_at: string }, index: number) =>
          <li key={`${review.created_at}-${index}`}><strong>{review.rating}/5</strong> · <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString(locale)}</time>
            <p>{review.review_text}</p>{review.seller_response ? <p>{t('p4.sellerResponse')}: {review.seller_response}</p> : null}</li>)}</ul>
      </section> : null}

      <section aria-labelledby="enq-h">
        <h2 id="enq-h">{t('dir.enquiryTitle')}</h2>
        {!b.accepting_requests ? (
          <p>{t('dir.busy')}</p>
        ) : user ? (
          <ActionForm action={sendEnquiryAction} submitLabel={t('dir.enquirySend')}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {orgs.length > 1 ? (
              <SelectField id="buyerOrgId" name="buyerOrgId" label={t('dir.enquiryAs')} defaultValue={orgs[0].org.id}>
                {orgs.map((m) => (
                  <option key={m.org.id} value={m.org.id}>
                    {m.org.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <Field id="topic" name="topic" label={t('dir.enquiryTopic')} hint={t('dir.enquiryTopicHint')} required minLength={3} maxLength={200} />
            <TextArea id="note" name="note" label={t('dir.enquiryNote')} hint={t('dir.enquiryNoteHint')} required maxLength={1000} />
            <p className="muted">{t('dir.enquiryPrivacy')}</p>
          </ActionForm>
        ) : (
          <p>
            <Link href={`/login?next=${next}`} locale={locale} className="btn btn-primary">
              {t('dir.enquirySignIn')}
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="rep-h">
        <h2 id="rep-h">{t('rep.title')}</h2>
        {user ? (
          <details>
            <summary>{t('rep.open')}</summary>
            <ActionForm action={reportAction} submitLabel={t('rep.send')} variant="secondary">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="type" value="listing" />
              <input type="hidden" name="target" value={slug} />
              <SelectField id="reason" name="reason" label={t('rep.reason')} defaultValue="misleading">
                {REPORT_REASONS.map((x) => (
                  <option key={x} value={x}>
                    {t(`rep.reasons.${x}`)}
                  </option>
                ))}
              </SelectField>
              <TextArea id="rnote" name="note" label={t('rep.note')} maxLength={500} />
            </ActionForm>
          </details>
        ) : (
          <p>
            <Link href={`/login?next=${next}`} locale={locale}>
              {t('rep.signIn')}
            </Link>
          </p>
        )}
      </section>
    </>
  );
}
