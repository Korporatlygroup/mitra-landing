import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import { Link } from '@/i18n/navigation';
import { uuidSchema } from '@/lib/schemas';
import { getNews } from '@/server/services/news';
import { getOptionalUser } from '@/server/session';
import { toggleSaveNewsAction } from '../actions';
import { NewsCategoryTile } from '@/components/workspace/NewsCategoryTile';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { id } = await params;
  const { supabase } = await getOptionalUser();
  const r = supabase && uuidSchema.safeParse(id).success ? await getNews(supabase, id) : null;
  return { title: r?.ok ? r.data.title : undefined };
}

export default async function NewsPostPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const { supabase, user } = await getOptionalUser();
  if (!supabase) notFound();
  const r = await getNews(supabase, id);
  if (!r.ok) notFound();
  const n = r.data;

  return (
    <article className="wide" style={{ maxWidth: '48rem', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Link href="/news" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
        <Icon name="back" size={16} stroke={2.2} />
        {t('news2.back')}
      </Link>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <NewsCategoryTile category={n.category} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="mut" style={{ fontSize: '0.8125rem' }}>
            {t('news2.published', { date: fmt.dateTime(new Date(n.published_at), { dateStyle: 'long', timeZone: 'Asia/Kuala_Lumpur' }) })}
            {n.states.length ? ` · ${n.states.join(', ')}` : ''}
          </span>
          <h1 style={{ margin: '4px 0 0' }} lang={n.language}>
            {n.title}
          </h1>
        </div>
      </div>
      {n.deadline_on ? (
        <span className="tag t-coral tag-lg" style={{ alignSelf: 'flex-start' }}>
          {t('news2.closes', { date: fmt.dateTime(new Date(`${n.deadline_on}T00:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' }) })}
        </span>
      ) : null}
      <div className="card" style={{ padding: 26 }} lang={n.language}>
        <p style={{ margin: '0 0 14px', fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.55 }}>{n.summary}</p>
        <div style={{ whiteSpace: 'pre-line', lineHeight: 1.75, color: '#2a3530' }}>{n.body}</div>
      </div>
      {user ? (
        <form action={toggleSaveNewsAction}>
          <input type="hidden" name="postId" value={n.id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="save" value={n.saved ? '0' : '1'} />
          <button type="submit" className="btn btn-secondary" aria-pressed={n.saved}>
            <Icon name="bookmark" size={18} />
            {n.saved ? t('news2.unsave') : t('news2.save')}
          </button>
        </form>
      ) : null}
    </article>
  );
}
