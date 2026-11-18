import { getFormatter, getTranslations } from 'next-intl/server';
import DataTable from '@/components/shared/DataTable';
import EmptyState from '@/components/shared/EmptyState';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge, { type BadgeTone } from '@/components/shared/StatusBadge';
import TabsNav from '@/components/shared/TabsNav';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { adminListNews } from '@/server/services/news';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'news2.admin.title');
}

const KINDS = ['draft', 'scheduled', 'published', 'archived'] as const;
type Kind = (typeof KINDS)[number];
const TONE: Record<Kind, BadgeTone> = { draft: 'gold', scheduled: 'brand', published: 'green', archived: 'neutral' };
const LABEL: Record<Kind, string> = { draft: 'sDraft', scheduled: 'sScheduled', published: 'sPublished', archived: 'sArchived' };

/** News administration: tabs per state with counts, a table, and the editor on the next page. Nothing publishes from this list. */
export default async function AdminNewsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  const s = await requireSession({ locale, path: '/admin/news' });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const mine = s.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(s.supabase, mine.role) : new Set<string>();
  if (!perms.has('programme:publish')) {
    return (
      <>
        <PageHeader title={t('news2.admin.title')} />
        <p className="message message-error" role="alert">
          {t('news2.admin.noAccess')}
        </p>
      </>
    );
  }
  const res = await adminListNews(s.supabase);
  const rows = res.ok ? res.data : [];
  const kindOf = (r: (typeof rows)[number]): Kind => (r.status === 'published' ? (r.live ? 'published' : 'scheduled') : r.status === 'archived' ? 'archived' : 'draft');
  const counts: Record<Kind, number> = { draft: 0, scheduled: 0, published: 0, archived: 0 };
  for (const r of rows) counts[kindOf(r)] += 1;
  const tab = (KINDS as readonly string[]).includes(String(sp.status)) ? (sp.status as Kind) : null;
  const shown = tab ? rows.filter((r) => kindOf(r) === tab) : rows;
  const catLabel = (c: string) => t(`news2.chip${c[0]!.toUpperCase()}${c.slice(1)}`);
  return (
    <>
      <PageHeader
        title={t('news2.admin.title')}
        sub={t('news2.admin.sub')}
        actions={
          <Link href="/admin/news/new" className="btn btn-primary">
            {t('news2.admin.newPost')}
          </Link>
        }
      />
      <TabsNav
        label={t('news2.admin.title')}
        items={[
          { href: '/admin/news', label: t('dir2.all'), count: rows.length, active: tab === null },
          ...KINDS.map((k) => ({ href: `/admin/news?status=${k}`, label: t(`news2.admin.${LABEL[k]}`), count: counts[k], active: tab === k })),
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState icon="news" title={t('news2.admin.none')} text={t('news2.admin.sub')} action={{ href: '/admin/news/new', label: t('news2.admin.newPost') }} />
      ) : (
        <DataTable
          caption={t('news2.admin.title')}
          columns={[
            { key: 'title', label: t('news2.admin.colTitle') },
            { key: 'category', label: t('news2.admin.colCategory') },
            { key: 'status', label: t('news2.admin.colStatus') },
            { key: 'updated', label: t('news2.admin.colUpdated') },
            { key: 'action', label: t('news2.admin.edit') },
          ]}
          rows={shown.map((r) => ({
            id: r.id,
            cells: {
              title: <strong>{r.title}</strong>,
              category: catLabel(r.category),
              status: <StatusBadge label={t(`news2.admin.${LABEL[kindOf(r)]}`)} tone={TONE[kindOf(r)]} />,
              updated: fmt.dateTime(new Date(r.updated_at), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' }),
              action: (
                <Link href={`/admin/news/${r.id}`} className="btn btn-secondary btn-sm" aria-label={`${t('news2.admin.edit')}: ${r.title}`}>
                  {t('news2.admin.edit')}
                </Link>
              ),
            },
          }))}
        />
      )}
    </>
  );
}
