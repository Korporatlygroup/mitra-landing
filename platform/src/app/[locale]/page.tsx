import { getTranslations } from 'next-intl/server';
import BusinessCard from '@/components/public/BusinessCard';
import Icon from '@/components/ui/Icon';
import Tag, { initialsOf, paletteFor } from '@/components/ui/Tag';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { categoryIcon } from '@/lib/category-ui';
import { MY_STATES } from '@/lib/schemas';
import { searchListings } from '@/server/services/directory';
import { getOptionalUser } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale;
  const nav = await getTranslations({ locale, namespace: 'nav' });
  const common = await getTranslations({ locale, namespace: 'common' });
  // The layout's title template does not apply to its own index page, so compose it here.
  return { title: { absolute: `${nav('home')} | ${common('appName')}` } };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const { supabase, user } = await getOptionalUser();

  const first = supabase ? await searchListings(supabase, { limit: 8 }) : null;
  const data = first?.ok ? first.data : null;
  const categories = data?.categories ?? [];
  // Per-category counts come from the database (one cheap call each; the directory is small).
  const counts = supabase
    ? await Promise.all(categories.map(async (c) => ({ slug: c.slug, n: await searchListings(supabase, { category: c.slug, limit: 1 }).then((r) => (r.ok ? r.data.total : 0)) })))
    : [];
  const countOf = (slug: string) => counts.find((c) => c.slug === slug)?.n ?? 0;
  const shown = categories.filter((c) => countOf(c.slug) > 0).concat(categories.filter((c) => countOf(c.slug) === 0)).slice(0, 12);
  const palette = (i: number) => paletteFor(String(i * 7 + 3));
  const demo = paletteFor('inok-sample');

  return (
    <div className="bleed home">
      <section className="hero">
        <div className="hero-disc hero-disc-a" aria-hidden="true" />
        <div className="hero-disc hero-disc-b" aria-hidden="true" />
        <div className="pub-wrap hero-grid">
          <div className="hero-copy">
            <span className="tag t-green tag-lg" style={{ alignSelf: 'flex-start' }}>
              <Icon name="check" size={14} stroke={2.6} />
              {t('home2.badge')}
            </span>
            <h1 className="hero-h1">
              {t('home2.heroA')} <span style={{ color: 'var(--brand)' }}>{t('home2.heroB')}</span>
            </h1>
            <p className="hero-sub">{t('home2.sub')}</p>
            <form role="search" method="get" action={`/${locale}/directory`} className="sbox">
              <label className="sfield" style={{ flex: '2 1 240px' }}>
                <span>{t('home2.whatLabel')}</span>
                <input type="text" name="q" maxLength={80} placeholder={t('home2.whatPlaceholder')} />
              </label>
              <span className="sdiv" aria-hidden="true" />
              <label className="sfield">
                <span>{t('home2.whereLabel')}</span>
                <select name="state" defaultValue="">
                  <option value="">{t('home2.whereAll')}</option>
                  {MY_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary" style={{ minHeight: 56, padding: '0 26px' }}>
                <Icon name="search" size={18} stroke={2.2} />
                {t('home2.search')}
              </button>
            </form>
            <div className="fchip-row">
              <span className="mut" style={{ fontSize: '0.875rem', fontWeight: 600, marginRight: 4 }}>
                {t('home2.tryLabel')}
              </span>
              {(['try1', 'try2', 'try3'] as const).map((k) => (
                <Link key={k} className="fchip" href={`/directory?q=${encodeURIComponent(t(`home2.${k}`))}`}>
                  {t(`home2.${k}`)}
                </Link>
              ))}
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="float f1">
              <div className="cover" style={{ height: 96, ['--c1' as string]: demo.c1, ['--c2' as string]: demo.c2 }} />
              <div className="f1-body">
                <span className="avt" style={{ top: -30, bottom: 'auto', ['--c1' as string]: demo.c1, ['--tint' as string]: demo.tint }}>
                  {initialsOf(t('home2.floatBizName'))}
                </span>
                <strong>{t('home2.floatBizName')}</strong>
                <span className="mut" style={{ fontSize: '0.8125rem' }}>
                  {t('home2.floatBizMeta')}
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <Tag tone="green">{t('dir2.reviewedTag')}</Tag>
                </span>
              </div>
            </div>
            <div className="float f2">
              <span className="f2-ic">
                <Icon name="bell" size={20} stroke={2} />
              </span>
              <span>
                <strong style={{ display: 'block', fontSize: '0.875rem' }}>{t('home2.floatMatch')}</strong>
                <span className="mut" style={{ fontSize: '0.8125rem' }}>
                  {t('home2.floatMatchSub')}
                </span>
              </span>
            </div>
            <div className="float f3">
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.875rem' }}>{t('home2.floatQuote')}</strong>
                <Tag tone="green">{t('home2.floatAccepted')}</Tag>
              </span>
              <span className="mut" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span>{t('home2.floatItem')}</span>
              </span>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '0.9375rem', borderTop: '1px solid #eef1ef', paddingTop: 10 }}>
                <span>{t('home2.floatTotal')}</span>
              </span>
            </div>
            <div className="float f4">
              <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--gold)' }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700 }}>{t('home2.floatPill')}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pub-wrap home-sec" style={{ paddingTop: 24 }} aria-labelledby="browse-h">
        <div className="sec-head">
          <h2 id="browse-h" className="h2">
            {t('home2.browse')}
          </h2>
          <Link href="/directory" className="btn btn-secondary btn-sm">
            {t('home2.allBusinesses')}
          </Link>
        </div>
        <ul className="cat-grid">
          {shown.map((c, i) => {
            const p = palette(i);
            return (
              <li key={c.slug}>
                <Link href={`/directory?category=${c.slug}`} className="cat" style={{ ['--c1' as string]: p.c1, ['--tint' as string]: p.tint }}>
                  <span className="ci">
                    <Icon name={categoryIcon(c.slug)} size={24} stroke={1.8} />
                  </span>
                  <strong>{catName(locale, c)}</strong>
                  <span className="mut" style={{ fontSize: '0.8125rem' }}>
                    {t('home2.count', { n: countOf(c.slug) })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pub-wrap home-sec" aria-labelledby="recent-h">
        <div className="sec-head">
          <h2 id="recent-h" className="h2">
            {t('home2.recent')}
          </h2>
          <Link href="/directory" className="btn btn-secondary btn-sm">
            {t('home2.seeMore')}
          </Link>
        </div>
        {data && data.items.length > 0 ? (
          <ul className="biz-grid">
            {data.items.slice(0, 4).map((b) => (
              <li key={b.slug} style={{ display: 'flex' }}>
                <div style={{ width: '100%', display: 'flex' }}>
                  <BusinessCard b={b} locale={locale} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">
            <strong>{t('home2.noneYet')}</strong>
          </div>
        )}
      </section>

      <section className="owners">
        <div className="pub-wrap owners-grid">
          <div className="owners-copy">
            <span className="tag" style={{ alignSelf: 'flex-start', background: 'var(--gold)', color: 'var(--on-gold)' }}>
              {t('home2.ownerTag')}
            </span>
            <h2 className="h2" style={{ color: '#fff' }}>
              {t('home2.ownerH')}
            </h2>
            <p style={{ margin: 0, color: '#c3cec9', fontSize: '1.05rem', lineHeight: 1.6 }}>{t('home2.ownerP')}</p>
            <div className="btn-row">
              <Link className="btn btn-gold" href="/signup">
                {t('home2.ownerCta')}
              </Link>
              {!user ? (
                <Link className="btn btn-secondary" href="/login" style={{ background: 'transparent', color: '#fff', borderColor: '#3b4842' }}>
                  {t('home2.ownerSee')}
                </Link>
              ) : null}
            </div>
          </div>
          <ol className="owner-steps">
            {(['s1', 's2', 's3', 's4'] as const).map((k, i) => (
              <li key={k}>
                <span className="owner-n">{`0${i + 1}`}</span>
                <strong>{t(`home2.${k}t`)}</strong>
                <span>{t(`home2.${k}d`)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
