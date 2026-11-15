import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import BusinessCard from '@/components/public/BusinessCard';
import ReviewedSwitch from '@/components/public/ReviewedSwitch';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { directoryFilterSchema, MY_STATES } from '@/lib/schemas';
import { searchListings, PAGE_SIZE, type ListingCard, type SearchResult } from '@/server/services/directory';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'dir.title');
}

function qs(f: { q?: string; category?: string; state?: string; page?: number; reviewed?: boolean }) {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.category) sp.set('category', f.category);
  if (f.state) sp.set('state', f.state);
  if (f.reviewed) sp.set('reviewed', '1');
  if (f.page && f.page > 1) sp.set('page', String(f.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

type Filters = { q?: string; category?: string; state?: string; page?: number };

/** One page of results. With "reviewed only" the pages are read up to a cap and filtered here, so counts and paging stay correct. */
async function load(db: NonNullable<Awaited<ReturnType<typeof getOptionalUser>>['supabase']>, f: Filters, reviewedOnly: boolean): Promise<SearchResult | null> {
  if (!reviewedOnly) {
    const r = await searchListings(db, f);
    return r.ok ? r.data : null;
  }
  const items: ListingCard[] = [];
  let categories: SearchResult['categories'] = [];
  for (let p = 1; p <= 10; p++) {
    const r = await searchListings(db, { ...f, page: p, limit: 24 });
    if (!r.ok) return null;
    categories = r.data.categories;
    items.push(...r.data.items.filter((b) => b.reviewed.some((c) => c.decided_at)));
    if (p * 24 >= r.data.total) break;
  }
  const page = f.page ?? 1;
  return { total: items.length, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), categories };
}

export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale });
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const parsed = directoryFilterSchema.safeParse({ q: one('q'), category: one('category'), state: one('state'), page: one('page') });
  const f = parsed.success ? parsed.data : { page: 1 };
  const reviewedOnly = one('reviewed') === '1';
  const { supabase } = await getOptionalUser();

  const data = supabase ? await load(supabase, f, reviewedOnly) : null;
  const filtered = Boolean(f.q || f.category || f.state || reviewedOnly);
  const page = f.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const activeCat = data?.categories.find((c) => c.slug === f.category);
  const keep = { q: f.q, state: f.state, reviewed: reviewedOnly };

  return (
    <div className="wide dir">
      <div className="dir-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>{t('dir.title')}</h1>
          {data ? (
            <span className="mut" style={{ fontSize: '0.95rem' }} aria-live="polite">
              <strong style={{ color: 'var(--ink)' }}>{t('dir2.results', { n: data.total })}</strong>
              {activeCat ? t('dir2.inCategory', { category: catName(locale, activeCat) }) : ''}
            </span>
          ) : null}
        </div>
        <form method="get" className="dir-search" role="search" aria-label={t('dir.searchLabel')}>
          <Icon name="search" size={18} />
          <label className="sr" htmlFor="q">
            {t('dir.q')}
          </label>
          <input id="q" name="q" type="search" defaultValue={f.q ?? ''} maxLength={80} placeholder={t('dir2.searchPlaceholder')} />
          <label className="sr" htmlFor="state">
            {t('dir.state')}
          </label>
          <select id="state" name="state" defaultValue={f.state ?? ''}>
            <option value="">{t('dir.anyState')}</option>
            {MY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {f.category ? <input type="hidden" name="category" value={f.category} /> : null}
          {reviewedOnly ? <input type="hidden" name="reviewed" value="1" /> : null}
          <button type="submit" className="btn btn-primary btn-sm">
            {t('dir.search')}
          </button>
        </form>
      </div>

      <p className="review-explain">{t('dir.reviewLimit')}</p>

      <div className="dir-filters">
        <nav className="fchip-row" aria-label={t('dir.category')}>
          <Link href={`/directory${qs({ ...keep })}`} className="fchip" aria-current={!f.category ? 'true' : undefined}>
            {t('dir2.all')}
          </Link>
          {(data?.categories ?? []).map((c) => (
            <Link key={c.slug} href={`/directory${qs({ ...keep, category: c.slug })}`} className="fchip" aria-current={f.category === c.slug ? 'true' : undefined}>
              {catName(locale, c)}
            </Link>
          ))}
        </nav>
        <span className="grow" />
        <Suspense fallback={null}>
          <ReviewedSwitch />
        </Suspense>
      </div>

      {!data ? (
        <p className="message message-error" role="alert">
          {t('dir.unavailable')}
        </p>
      ) : data.items.length === 0 ? (
        <section className="empty" aria-labelledby="none-h">
          <h2 id="none-h" style={{ margin: 0, fontSize: '1rem' }}>
            {t('dir.noneTitle')}
          </h2>
          <p className="mut" style={{ margin: 0 }}>
            {t('dir.noneBody')}
          </p>
          {filtered ? (
            <Link href="/directory" className="btn btn-secondary btn-sm">
              {t('dir.noneClear')}
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          <ul className="biz-grid">
            {data.items.map((b) => (
              <li key={b.slug} style={{ display: 'flex' }}>
                <div style={{ width: '100%', display: 'flex' }}>
                  <BusinessCard b={b} locale={locale} withDesc />
                </div>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t('dir.pages')} className="dir-pages">
              {page > 1 ? (
                <Link href={`/directory${qs({ ...f, reviewed: reviewedOnly, page: page - 1 })}`} className="btn btn-secondary btn-sm">
                  {t('dir.prev')}
                </Link>
              ) : null}
              <span>{t('dir.pageOf', { page, pages })}</span>
              {page < pages ? (
                <Link href={`/directory${qs({ ...f, reviewed: reviewedOnly, page: page + 1 })}`} className="btn btn-secondary btn-sm">
                  {t('dir.next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}

      <div className="dir-banner">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 320px' }}>
          <strong>{t('dir2.canTFind')}</strong>
          <span style={{ color: '#f6d6e1' }}>{t('dir2.canTFindSub')}</span>
        </div>
        <Link href="/requests/new" className="btn btn-gold">
          {t('dir2.postRequest')}
        </Link>
      </div>
    </div>
  );
}
