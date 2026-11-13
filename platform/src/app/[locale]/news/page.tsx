import { getFormatter, getTranslations } from 'next-intl/server';
import BulletinPrefs from '@/components/workspace/BulletinPrefs';
import Icon from '@/components/ui/Icon';
import { CAT_STYLE, NewsCategoryTile } from '@/components/workspace/NewsCategoryTile';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { getOptionalUser } from '@/server/session';
import { getNewsPrefs, listNews, newsDeadlines, NEWS_CATEGORIES, NEWS_PAGE, type NewsCategory, type NewsItem } from '@/server/services/news';
import { getBusinessProfile, listCategories } from '@/server/services/verification';
import { getWorkspace } from '@/server/workspace';
import { toggleSaveNewsAction } from './actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'news2.title');
}

export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const { supabase, user } = await getOptionalUser();
  if (!supabase) return <p className="message message-error">{t('dir.unavailable')}</p>;

  // What we know about the signed-in business: its type and state (used only to pick posts, never shown to others).
  const ws = user ? await getWorkspace() : null;
  let sector: string | null = null;
  let state: string | null = null;
  let sectorName: string | null = null;
  if (ws?.org && ws.kind === 'business') {
    const [prof, cats] = await Promise.all([getBusinessProfile(supabase, ws.org.id), listCategories(supabase)]);
    const cat = cats.find((c) => c.id === prof?.category_id);
    sector = cat?.slug ?? null;
    sectorName = cat ? catName(locale, cat) : null;
    state = prof?.state ?? null;
  }
  const personal = Boolean(sector || state);

  const raw = typeof sp.topic === 'string' ? sp.topic : '';
  const topic: 'for-you' | 'saved' | NewsCategory | 'all' = raw === 'saved' && user ? 'saved' : raw === 'for-you' && personal ? 'for-you' : (NEWS_CATEGORIES as readonly string[]).includes(raw) ? (raw as NewsCategory) : personal && !raw ? 'for-you' : 'all';
  const page = Math.max(1, Math.min(80, Number(typeof sp.page === 'string' ? sp.page : '1') || 1));

  const res = await listNews(supabase, {
    category: (NEWS_CATEGORIES as readonly string[]).includes(topic) ? (topic as NewsCategory) : null,
    sector: topic === 'for-you' ? sector : null,
    state: topic === 'for-you' ? state : null,
    savedOnly: topic === 'saved',
    page,
  });
  const data = res.ok ? res.data : { total: 0, items: [] as NewsItem[] };
  const pages = Math.max(1, Math.ceil(data.total / NEWS_PAGE));
  const [deadlines, prefs] = await Promise.all([newsDeadlines(supabase, 5), user ? getNewsPrefs(supabase) : Promise.resolve(null)]);
  const matches = (n: NewsItem) => Boolean((sector && n.sectors.includes(sector)) || (state && n.states.includes(state)));
  const href = (tp: string, p = 1) => `/news?topic=${tp}${p > 1 ? `&page=${p}` : ''}`;
  const chips: { key: string; label: string }[] = [
    ...(personal ? [{ key: 'for-you', label: t('news2.chipFor') }] : [{ key: 'all', label: t('news2.chipAll') }]),
    ...NEWS_CATEGORIES.map((c) => ({ key: c, label: t(`news2.${CAT_STYLE[c].label}`) })),
    ...(user ? [{ key: 'saved', label: t('news2.chipSaved') }] : []),
  ];
  const langName = (l: string) => (l === 'ta' ? t('common.langTa') : l === 'ms' ? t('common.langMs') : t('common.langEn'));

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('news2.title')}</h1>
          <p className="page-sub">{personal && sectorName && state ? t('news2.subFor', { category: sectorName, state }) : t('news2.subPublic')}</p>
        </div>
      </div>

      <nav aria-label={t('news2.filters')} className="fchip-row">
        {chips.map((c) => (
          <Link key={c.key} href={href(c.key)} className="fchip" aria-current={topic === c.key ? 'true' : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.items.length === 0 ? (
            <div className="empty">
              <strong>{t('news2.empty')}</strong>
              <span className="mut">{topic === 'saved' ? t('news2.emptySaved') : t('news2.emptyBody')}</span>
            </div>
          ) : (
            <ul className="card-list">
              {data.items.map((n) => (
                <li key={n.id} className="card news-card">
                  <NewsCategoryTile category={n.category} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {matches(n) ? <span className="tag t-green">{t('news2.matches')}</span> : null}
                      <span className="mut" style={{ fontSize: '0.8125rem' }}>
                        {[t('news2.published', { date: fmt.dateTime(new Date(n.published_at), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) }), n.states.length ? n.states.join(', ') : null, n.language !== locale ? t('news2.langTag', { lang: langName(n.language) }) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1.125rem', lineHeight: 1.3 }}>
                      <Link href={`/news/${n.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {n.title}
                      </Link>
                    </h2>
                    <p style={{ margin: 0, color: 'var(--text-2)', fontSize: '0.9375rem', lineHeight: 1.5 }}>{n.summary}</p>
                    {n.deadline_on ? (
                      <span className="tag t-coral" style={{ alignSelf: 'flex-start' }}>
                        {t('news2.closes', { date: fmt.dateTime(new Date(`${n.deadline_on}T00:00:00Z`), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) })}
                      </span>
                    ) : null}
                    <div className="btn-row" style={{ marginTop: 4 }}>
                      <Link className="btn btn-primary btn-sm" href={`/news/${n.id}`}>
                        {t('news2.read')}
                      </Link>
                      {user ? (
                        <form action={toggleSaveNewsAction}>
                          <input type="hidden" name="postId" value={n.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="save" value={n.saved ? '0' : '1'} />
                          <button type="submit" className="btn btn-secondary btn-sm" aria-pressed={n.saved} aria-label={t(n.saved ? 'news2.unsaveAria' : 'news2.saveAria', { title: n.title })}>
                            <Icon name="bookmark" size={16} />
                            {n.saved ? t('news2.unsave') : t('news2.save')}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <nav aria-label={t('dir.pages')} className="dir-pages">
              {page > 1 ? (
                <Link className="btn btn-secondary btn-sm" href={href(topic, page - 1)}>
                  {t('news2.prev')}
                </Link>
              ) : null}
              <span>{t('news2.pageOf', { page, pages })}</span>
              {page < pages ? (
                <Link className="btn btn-secondary btn-sm" href={href(topic, page + 1)}>
                  {t('news2.next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>

        <aside style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {prefs?.ok ? (
            <BulletinPrefs initial={prefs.data} />
          ) : (
            <div className="card" style={{ background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <strong style={{ fontSize: '1.0625rem' }}>{t('news2.signInCta')}</strong>
              <span style={{ color: '#c3cec9', fontSize: '0.875rem', lineHeight: 1.55 }}>{t('news2.signInBody')}</span>
              <Link className="btn btn-gold" href={`/login?next=${encodeURIComponent(`/${locale}/news`)}`}>
                {t('news2.signIn')}
              </Link>
            </div>
          )}
          <div className="card" style={{ padding: 22 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.0625rem' }}>{t('news2.deadlinesTitle')}</h2>
            {deadlines.ok && deadlines.data.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {deadlines.data.map((d) => {
                  const when = new Date(`${d.deadline_on}T00:00:00Z`);
                  return (
                    <li key={d.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid #eef1ef' }}>
                      <span className="date-block" aria-hidden="true">
                        <strong>{fmt.dateTime(when, { day: 'numeric', timeZone: 'UTC' })}</strong>
                        <small>{fmt.dateTime(when, { month: 'short', timeZone: 'UTC' })}</small>
                      </span>
                      <Link href={`/news/${d.id}`} aria-label={t('news2.deadlineAria', { title: d.title, date: fmt.dateTime(when, { dateStyle: 'medium', timeZone: 'UTC' }) })} style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem' }}>
                        {d.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mut" style={{ margin: 0 }}>
                {t('news2.deadlinesNone')}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
