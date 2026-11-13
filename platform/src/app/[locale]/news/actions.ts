'use server';

import { revalidatePath } from 'next/cache';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { saveNews, setNewsPrefs, unsaveNews, type NewsPrefs } from '@/server/services/news';

/** Save or unsave a post for the signed-in person. */
export async function toggleSaveNewsAction(formData: FormData): Promise<void> {
  const id = uuidSchema.safeParse(formData.get('postId'));
  const locale = localeSchema.catch('en').parse(formData.get('locale'));
  const { supabase, user } = await actionUser();
  if (!user || !id.success) return;
  const r = formData.get('save') === '1' ? await saveNews(supabase, id.data) : await unsaveNews(supabase, id.data);
  if (r.ok) revalidatePath(`/${locale}/news`, 'layout');
}

/** One preference changed in the "Your bulletin" box: saved right away, no separate button. */
export async function updateNewsPrefsAction(data: Partial<NewsPrefs>): Promise<{ ok: boolean }> {
  const clean: Partial<NewsPrefs> = {};
  for (const k of ['grants', 'training', 'deadlines', 'community', 'weekly_email'] as const) if (typeof data[k] === 'boolean') clean[k] = data[k];
  if (data.language === 'en' || data.language === 'ta' || data.language === 'ms') clean.language = data.language;
  const { supabase, user } = await actionUser();
  if (!user) return { ok: false };
  const r = await setNewsPrefs(supabase, clean);
  if (r.ok) revalidatePath('/', 'layout');
  return { ok: r.ok };
}
