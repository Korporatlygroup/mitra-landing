import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { adminListNews } from '@/server/services/news';
import { getRolePermissions } from '@/server/services/orgs';
import { requireSession } from '@/server/session';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'news2.admin.title');
}

export default async function AdminNewsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const s = await requireSession({ locale, path: '/admin/news' });
  const t = await getTranslations({ locale });
  const fmt = await getFormatter({ locale });
  const mine = s.memberships.find((m) => m.org.type === 'mitra');
  const perms = mine ? await getRolePermissions(s.supabase, mine.role) : new Set<string>();
  if (!perms.has('programme:publish')) {
    return (
      <>
        <h1>{t('news2.admin.title')}</h1>
        <p className="message message-error" role="alert">
          {t('news2.admin.noAccess')}
        </p>
      </>
    );
  }
  const res = await adminListNews(s.supabase);
  const rows = res.ok ? res.data : [];
  const label = (r: (typeof rows)[number]) =>
    r.status === 'published' ? (r.live ? t('news2.admin.sPublished') : t('news2.admin.sScheduled')) : r.status === 'archived' ? t('news2.admin.sArchived') : t('news2.admin.sDraft');
  const tone = (r: (typeof rows)[number]) => (r.status === 'published' ? (r.live ? 'green' : 'blue') : r.status === 'archived' ? 'gray' : 'gold');
  const catLabel = (c: string) => t(`news2.chip${c[0]!.toUpperCase()}${c.slice(1)}`);
  return (
    <>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t('news2.admin.title')}</h1>
          <p className="page-sub">{t('news2.admin.sub')}</p>
        </div>
        <Link href="/admin/news/new" className="btn btn-primary">
          {t('news2.admin.newPost')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <strong>{t('news2.admin.none')}</strong>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th scope="col">{t('news2.admin.colTitle')}</th>
                <th scope="col">{t('news2.admin.colCategory')}</th>
                <th scope="col">{t('news2.admin.colStatus')}</th>
                <th scope="col">{t('news2.admin.colUpdated')}</th>
                <th scope="col">
                  <span className="sr">{t('news2.admin.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('news2.admin.colTitle')}>
                    <strong>{r.title}</strong>
                  </td>
                  <td data-label={t('news2.admin.colCategory')}>{catLabel(r.category)}</td>
                  <td data-label={t('news2.admin.colStatus')}>
                    <span className={`tag t-${tone(r)}`}>{label(r)}</span>
                  </td>
                  <td data-label={t('news2.admin.colUpdated')}>{fmt.dateTime(new Date(r.updated_at), { dateStyle: 'medium', timeZone: 'Asia/Kuala_Lumpur' })}</td>
                  <td>
                    <Link href={`/admin/news/${r.id}`} className="btn btn-secondary btn-sm" aria-label={`${t('news2.admin.edit')}: ${r.title}`}>
                      {t('news2.admin.edit')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
