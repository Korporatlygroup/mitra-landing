import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { directoryFilterSchema, MY_STATES } from '@/lib/schemas';
import { searchListings, PAGE_SIZE, type ListingCard } from '@/server/services/directory';
import { getOptionalUser } from '@/server/session';
import { catName } from '@/lib/category';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'dir.title');
}

function qs(f: { q?: string; category?: string; state?: string; page?: number }) {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.category) sp.set('category', f.category);
  if (f.state) sp.set('state', f.state);
  if (f.page && f.page > 1) sp.set('page', String(f.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function Card({ b, locale }: { b: ListingCard; locale: string }) {
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const place = [b.district, b.state].filter(Boolean).join(', ');
  const reviewed = b.reviewed.filter((c) => c.decided_at);
  return (
    <li className="card">
      <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>
        <Link href={`/directory/${b.slug}`} locale={locale}>
          {b.name}
        </Link>
      </h2>
      <p className="muted" style={{ margin: '0 0 6px' }}>
        {catName(locale, b.category)}
        {place ? ` · ${place}` : null}
      </p>
      {b.headline ? <p style={{ margin: '0 0 6px' }}>{b.headline}</p> : null}
      {b.services.length > 0 ? <p style={{ margin: '0 0 6px' }}>{b.services.slice(0, 4).join(' · ')}</p> : null}
      <p className="muted" style={{ margin: 0 }}>
        {b.serves_nationwide ? t('dir.allMalaysia') : b.serves_states.length > 0 ? t('dir.servesStates', { states: b.serves_states.join(', ') }) : null}
      </p>
      <p className="muted" style={{ margin: '6px 0 0' }}>
        {reviewed.length > 0
          ? reviewed.map((c) => (
              <span key={c.claim_type} style={{ display: 'block' }}>
                {t('preview.reviewedOn', {
                  date: fmt.dateTime(new Date(c.decided_at as string), { dateStyle: 'medium', timeZone: 'UTC' }),
                  scope: t(`claimScope.${c.claim_type}`),
                })}
              </span>
            ))
          : t('dir.notReviewed')}
      </p>
    </li>
  );
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
  const { supabase } = await getOptionalUser();

  const result = supabase ? await searchListings(supabase, f) : null;
  const data = result?.ok ? result.data : null;
  const filtered = Boolean(f.q || f.category || f.state);
  const page = f.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h1>{t('dir.title')}</h1>
      <p>{t('dir.intro')}</p>

      <form method="get" className="form" role="search" aria-label={t('dir.searchLabel')}>
        <div className="field">
          <label htmlFor="q">{t('dir.q')}</label>
          <p className="hint" id="q-hint">
            {t('dir.qHint')}
          </p>
          <input id="q" name="q" type="search" defaultValue={f.q ?? ''} maxLength={80} aria-describedby="q-hint" />
        </div>
        <div className="field">
          <label htmlFor="category">{t('dir.category')}</label>
          <select id="category" name="category" defaultValue={f.category ?? ''}>
            <option value="">{t('dir.anyCategory')}</option>
            {(data?.categories ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {catName(locale, c)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="state">{t('dir.state')}</label>
          <select id="state" name="state" defaultValue={f.state ?? ''}>
            <option value="">{t('dir.anyState')}</option>
            {MY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          {t('dir.search')}
        </button>
      </form>

      {!data ? (
        <p className="message message-error" role="alert">
          {t('dir.unavailable')}
        </p>
      ) : data.items.length === 0 ? (
        <section aria-labelledby="none-h">
          <h2 id="none-h">{t('dir.noneTitle')}</h2>
          <p>{t('dir.noneBody')}</p>
          <ul>
            <li>{t('dir.noneTipWords')}</li>
            {filtered ? (
              <li>
                <Link href="/directory" locale={locale}>
                  {t('dir.noneClear')}
                </Link>
              </li>
            ) : null}
          </ul>
          <p className="link-row">
            <Link href="/requests/new" locale={locale} className="btn btn-primary">
              {t('dir.postRequest')}
            </Link>
          </p>
        </section>
      ) : (
        <>
          <p aria-live="polite">{t('dir.count', { n: data.total })}</p>
          <ul className="card-list">
            {data.items.map((b) => (
              <Card key={b.slug} b={b} locale={locale} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label={t('dir.pages')} className="link-row">
              {page > 1 ? (
                <Link href={`/directory${qs({ ...f, page: page - 1 })}`} locale={locale} className="btn btn-secondary">
                  {t('dir.prev')}
                </Link>
              ) : null}
              <span>{t('dir.pageOf', { page, pages })}</span>
              {page < pages ? (
                <Link href={`/directory${qs({ ...f, page: page + 1 })}`} locale={locale} className="btn btn-secondary">
                  {t('dir.next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
          <p>
            <Link href="/requests/new" locale={locale} className="btn btn-secondary">
              {t('dir.postRequestAlt')}
            </Link>
          </p>
        </>
      )}
    </>
  );
}
