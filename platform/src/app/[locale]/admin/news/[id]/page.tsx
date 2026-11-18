import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import NewsEditor, { type EditorPost } from '@/components/admin/NewsEditor';
import { Link } from '@/i18n/navigation';
import { catName } from '@/lib/category';
import { pageTitle } from '@/lib/metadata';
import { MY_STATES, uuidSchema } from '@/lib/schemas';
import { adminGetNews, NEWS_CATEGORIES } from '@/server/services/news';
import { getRolePermissions } from '@/server/services/orgs';
import { listCategories } from '@/server/services/verification';
import { requireSession } from '@/server/session';
import PageHeader from '@/components/shared/PageHeader';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'news2.admin.title');
}

const toLocalInput = (iso: unknown) => {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const my = new Date(d.getTime() + 8 * 3600000); // Malaysia time, as typed by staff
  return my.toISOString().slice(0, 16);
};

export default async function AdminNewsPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const isNew = id === 'new';
  if (!isNew && !uuidSchema.safeParse(id).success) notFound();
  const s = await requireSession({ locale, path: `/admin/news/${id}` });
  const t = await getTranslations({ locale });
  const mine = s.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(s.supabase, mine.role) : new Set<string>();
  if (!perms.has('programme:publish')) {
    return (
      <p className="message message-error" role="alert">
        {t('news2.admin.noAccess')}
      </p>
    );
  }
  const cats = await listCategories(s.supabase);
  let post: EditorPost = { id: null, version: null, title: '', summary: '', body: '', category: 'grants', language: 'en', deadline_on: '', publish_at: '', source_url: '', publisher: '', source_published_on: '', retrieved_on: '', sectors: [], states: [], status: 'new' };
  if (!isNew) {
    const r = await adminGetNews(s.supabase, id);
    if (!r.ok) notFound();
    const d = r.data as Record<string, unknown>;
    post = {
      id,
      version: Number(d.version),
      title: String(d.title ?? ''),
      summary: String(d.summary ?? ''),
      body: String(d.body ?? ''),
      category: d.category as EditorPost['category'],
      language: d.language as EditorPost['language'],
      deadline_on: typeof d.deadline_on === 'string' ? d.deadline_on : '',
      publish_at: toLocalInput(d.publish_at),
      source_url: typeof d.source_url === 'string' ? d.source_url : '',
      publisher: typeof d.publisher === 'string' ? d.publisher : '',
      source_published_on: typeof d.source_published_on === 'string' ? d.source_published_on : '',
      retrieved_on: typeof d.retrieved_on === 'string' ? d.retrieved_on : '',
      sectors: (d.sectors as string[]) ?? [],
      states: (d.states as string[]) ?? [],
      status: d.status as EditorPost['status'],
    };
  }
  return (
    <>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <PageHeader title={isNew ? t('news2.admin.newPost') : post.title} />
          {sp.saved ? (
            <p className="message message-ok" role="status">
              {t('news2.admin.saved')}
            </p>
          ) : null}
        </div>
        <div className="btn-row">
          <Link href="/admin/news" className="btn btn-secondary btn-sm">
            {t('news2.admin.title')}
          </Link>
          {post.id && post.status === 'published' ? (
            <Link href={`/news/${post.id}`} className="btn btn-secondary btn-sm">
              {t('news2.admin.preview')}
            </Link>
          ) : null}
        </div>
      </div>
      <NewsEditor
        post={post}
        categories={NEWS_CATEGORIES.map((c) => ({ value: c, label: t(`news2.chip${c[0]!.toUpperCase()}${c.slice(1)}`) }))}
        states={[...MY_STATES]}
        sectorLabels={cats.map((c) => ({ slug: c.slug, label: catName(locale, c) }))}
      />
    </>
  );
}
