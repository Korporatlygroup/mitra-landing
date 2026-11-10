import { getTranslations } from 'next-intl/server';
import StatusChip from '@/components/StatusChip';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/lib/metadata';
import { MY_STATES } from '@/lib/schemas';
import { requireBusinessContext } from '@/server/business-context';
import { BOARD_PAGE_SIZE, listBoardRequests } from '@/server/services/directory';
import { listCategories } from '@/server/services/verification';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return pageTitle((await params).locale, 'board.title');
}

const first = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default async function RequestBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessContext(locale, id, '/requests/board');
  const t = await getTranslations({ locale });
  const base = `/orgs/${id}/business`;

  if (!ctx.perms.has('request:respond')) {
    return (
      <>
        <h1>{t('board.title')}</h1>
        <p className="message message-error" role="alert">
          {t('errors.forbidden')}
        </p>
      </>
    );
  }

  const categories = await listCategories(ctx.session.supabase);
  const category = categories.some((c) => c.slug === first(sp.category)) ? first(sp.category) : '';
  const state = (MY_STATES as readonly string[]).includes(first(sp.state)) ? first(sp.state) : '';
  const rawPage = Number(first(sp.page) || '1');
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 500 ? rawPage : 1;
  const res = await listBoardRequests(ctx.session.supabase, id, { category, state, offset: (page - 1) * BOARD_PAGE_SIZE });
  const filtered = Boolean(category || state);
  const query = (p: number) => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (state) q.set('state', state);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return `${base}/requests/board${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <p>
        <Link href={`${base}/requests`} locale={locale}>
          {t('inbox.title')}
        </Link>
      </p>
      <h1>{t('board.title')}</h1>
      <p>{t('board.intro')}</p>

      <form method="get" className="card" aria-label={t('board.apply')}>
        <div className="field">
          <label htmlFor="board-category">{t('board.category')}</label>
          <select id="board-category" name="category" defaultValue={category}>
            <option value="">{t('board.all')}</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {locale === 'ta' ? c.name_ta : c.name_en}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="board-state">{t('board.state')}</label>
          <select id="board-state" name="state" defaultValue={state}>
            <option value="">{t('board.all')}</option>
            {MY_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          {t('board.apply')}
        </button>
      </form>

      {!res.ok ? (
        <p className="message message-error" role="alert">
          {t(`errors.${res.errorKey}`)}
        </p>
      ) : res.items.length === 0 ? (
        <section>
          <h2>{t('board.emptyTitle')}</h2>
          <p>{filtered ? t('board.emptyFiltered') : t('board.emptyBody')}</p>
          {!filtered ? (
            <p>
              <Link href={`${base}/listing`} locale={locale}>
                {t('inbox.emptyHint')}
              </Link>
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <p aria-live="polite">{t('board.count', { n: res.total })}</p>
          <ul className="card-list">
            {res.items.map((r) => {
              const cat = categories.find((c) => c.slug === r.category_slug);
              return (
                <li key={r.request_id} className="card" data-testid="board-row">
                  <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>
                    <Link href={`${base}/requests/${r.request_id}`} locale={locale}>
                      {r.title}
                    </Link>
                  </h2>
                  <p className="muted" style={{ margin: '0 0 6px' }}>
                    {[
                      cat ? (locale === 'ta' ? cat.name_ta : cat.name_en) : null,
                      [r.target_district, r.target_state].filter(Boolean).join(', '),
                      r.quantity ? `${r.quantity} ${r.unit ?? ''}` : null,
                      r.needed_by ? t('inbox.by', { date: r.needed_by }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p style={{ margin: 0 }}>
                    <StatusChip
                      status={r.my_status === 'interested' || r.my_status === 'question' ? 'approved' : 'none'}
                      label={r.my_status ? t(`inbox.status.${r.my_status}`) : t('board.notAnswered')}
                    />
                  </p>
                </li>
              );
            })}
          </ul>
          <nav className="link-row" aria-label={t('board.title')}>
            {page > 1 ? (
              <Link href={query(page - 1)} locale={locale} className="btn btn-secondary">
                {t('board.prev')}
              </Link>
            ) : null}
            {page * BOARD_PAGE_SIZE < res.total ? (
              <Link href={query(page + 1)} locale={locale} className="btn btn-secondary">
                {t('board.next')}
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </>
  );
}
