import { failFrom, ok, type Db, type Result } from './result';

/** News and bulletins: published feed (public), saved posts, topic preferences, and staff publishing. */

export const NEWS_CATEGORIES = ['grants', 'training', 'deadlines', 'community'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export type NewsLanguage = 'en' | 'ta' | 'ms';

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  category: NewsCategory;
  sectors: string[];
  states: string[];
  language: NewsLanguage;
  deadline_on: string | null;
  published_at: string;
  saved: boolean;
}
export interface NewsDetail extends NewsItem {
  body: string;
}
export interface NewsPrefs {
  grants: boolean;
  training: boolean;
  deadlines: boolean;
  community: boolean;
  weekly_email: boolean;
  language: NewsLanguage;
}
export interface AdminNewsRow {
  id: string;
  title: string;
  summary: string;
  category: NewsCategory;
  language: NewsLanguage;
  status: 'draft' | 'published' | 'archived';
  publish_at: string | null;
  deadline_on: string | null;
  version: number;
  updated_at: string;
  sectors: string[];
  states: string[];
  live: boolean;
}

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  return error ? failFrom(error) : ok(data as T);
}

export const NEWS_PAGE = 12;

export const listNews = (db: Db, f: { category?: NewsCategory | null; language?: NewsLanguage | null; sector?: string | null; state?: string | null; savedOnly?: boolean; page?: number }) =>
  rpc<{ total: number; items: NewsItem[] }>(db, 'news_list', {
    p_category: f.category ?? null,
    p_language: f.language ?? null,
    p_sector: f.sector ?? null,
    p_state: f.state ?? null,
    p_saved_only: f.savedOnly ?? false,
    p_limit: NEWS_PAGE,
    p_offset: ((f.page ?? 1) - 1) * NEWS_PAGE,
  });
export const getNews = (db: Db, id: string) => rpc<NewsDetail>(db, 'news_get', { p_id: id });
export const newsDeadlines = (db: Db, limit = 5) => rpc<{ id: string; title: string; deadline_on: string }[]>(db, 'news_deadlines', { p_limit: limit });
export const saveNews = (db: Db, id: string) => rpc<null>(db, 'news_save', { p_id: id });
export const unsaveNews = (db: Db, id: string) => rpc<null>(db, 'news_unsave', { p_id: id });
export const getNewsPrefs = (db: Db) => rpc<NewsPrefs>(db, 'news_get_prefs', {});
export const setNewsPrefs = (db: Db, data: Partial<NewsPrefs>) => rpc<null>(db, 'news_set_prefs', { p_data: data });

export const adminListNews = (db: Db) => rpc<AdminNewsRow[]>(db, 'admin_news_list', {});
export const adminGetNews = (db: Db, id: string) => rpc<Record<string, unknown>>(db, 'admin_news_get', { p_id: id });
export const adminSaveNews = (db: Db, id: string | null, data: Record<string, unknown>, expectedVersion: number | null) =>
  rpc<{ id: string; version: number; status: string }>(db, 'admin_news_save', { p_id: id, p_data: data, p_expected_version: expectedVersion });
export const adminSetNewsStatus = (db: Db, id: string, status: 'draft' | 'published' | 'archived', publishAt: string | null, expectedVersion: number) =>
  rpc<null>(db, 'admin_news_set_status', { p_id: id, p_status: status, p_publish_at: publishAt, p_expected_version: expectedVersion });
