import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ActionForm from '@/components/ActionForm';
import { SelectField, TextArea } from '@/components/Field';
import ListingView from '@/components/ListingView';
import EnquiryDialog from '@/components/public/EnquiryDialog';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { eligibleBuyerOrgs } from '@/lib/buyer-orgs';
import { REPORT_REASONS } from '@/lib/schemas';
import { getListing } from '@/server/services/directory';
import { listPublicProducts } from '@/server/services/biz-products';
import { listMyMemberships } from '@/server/services/orgs';
import { getOptionalUser } from '@/server/session';
import { reportAction } from '../actions';

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
  const [{ data: publishedReviews }, products] = await Promise.all([supabase.rpc('list_published_business_reviews', { p_slug: slug }), listPublicProducts(supabase, slug)]);

  const memberships = user ? await listMyMemberships(supabase, user.id) : [];
  const orgs = eligibleBuyerOrgs(memberships);
  const next = encodeURIComponent(`/${locale}/directory/${slug}`);

  const reviewList =
    (publishedReviews?.length ?? 0) > 0 ? (
      <section aria-labelledby="reviews-h">
        <h2 id="reviews-h" style={{ marginTop: 0 }}>
          {t('p4.publishedReviews')}
        </h2>
        <ul className="card-list">
          {publishedReviews!.map((review: { rating: number; review_text: string; seller_response: string | null; created_at: string }, index: number) => (
            <li key={`${review.created_at}-${index}`} className="card" style={{ boxShadow: 'none' }}>
              <strong>{review.rating}/5</strong> ·{' '}
              <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString(locale)}</time>
              <p>{review.review_text}</p>
              {review.seller_response ? (
                <p>
                  {t('p4.sellerResponse')}: {review.seller_response}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    ) : undefined;

  return (
    <>
      <ListingView
        data={{ ...b, slug, products }}
        locale={locale}
        back={
          <Link href="/directory" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
            <Icon name="back" size={16} stroke={2.2} />
            {t('dir2.back')}
          </Link>
        }
        actions={<EnquiryDialog slug={slug} name={b.name} accepting={b.accepting_requests} signedIn={Boolean(user)} orgs={orgs.map((m) => ({ id: m.org.id, name: m.org.name }))} next={next} />}
        reviews={reviewList}
      />

      <section aria-labelledby="rep-h" className="wide" style={{ marginTop: 28 }}>
        <h2 id="rep-h" style={{ fontSize: '1rem' }}>
          {t('rep.title')}
        </h2>
        {user ? (
          <details className="card">
            <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', fontWeight: 700 }}>{t('rep.open')}</summary>
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
            <Link href={`/login?next=${next}`}>{t('rep.signIn')}</Link>
          </p>
        )}
      </section>
    </>
  );
}
