'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { localeSchema, MY_STATES, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { adminSaveNews, adminSetNewsStatus, NEWS_CATEGORIES } from '@/server/services/news';

const schema = z.object({
  locale: localeSchema,
  id: z.preprocess((v) => (v === '' || v == null ? undefined : v), uuidSchema.optional()),
  version: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).optional()),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(10).max(400),
  body: z.string().trim().min(10).max(20000),
  category: z.enum(NEWS_CATEGORIES),
  language: z.enum(['en', 'ta', 'ms']),
  deadline_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  publish_at: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(40).optional()),
  publisher: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(120).optional()),
  source_url: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(500).optional()),
  source_published_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  retrieved_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  intent: z.enum(['save', 'publish', 'draft', 'archive']),
});

/** Save a news post and, if asked, publish it (now or at a chosen time), move it back to draft, or archive it. */
export async function saveNewsPostAction(_prev: FormState, f: FormData): Promise<FormState> {
  const raw = Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === 'string'));
  const p = schema.safeParse(raw);
  if (!p.success) return failure('invalid_input', { title: String(raw.title ?? ''), summary: String(raw.summary ?? ''), body: String(raw.body ?? '') });
  const d = p.data;
  const sectors = f.getAll('sectors').map(String).filter((s) => /^[a-z0-9-]{2,40}$/.test(s));
  const states = f.getAll('states').map(String).filter((s) => (MY_STATES as readonly string[]).includes(s));
  let publishAt: string | null = null;
  if (d.publish_at) {
    const when = new Date(d.publish_at);
    if (Number.isNaN(when.getTime())) return failure('invalid_date');
    publishAt = when.toISOString();
  }
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const saved = await adminSaveNews(
    supabase,
    d.id ?? null,
    { title: d.title, summary: d.summary, body: d.body, category: d.category, language: d.language, deadline_on: d.deadline_on ?? '', publish_at: publishAt ?? '', sectors, states,
      source_url: d.source_url ?? '', publisher: d.publisher ?? '', source_published_on: d.source_published_on ?? '', retrieved_on: d.retrieved_on ?? '' },
    d.version ?? null,
  );
  if (!saved.ok) return failure(saved.errorKey);
  const status = d.intent === 'publish' ? 'published' : d.intent === 'draft' ? 'draft' : d.intent === 'archive' ? 'archived' : null;
  if (status) {
    const r = await adminSetNewsStatus(supabase, saved.data.id, status, status === 'published' ? publishAt : null, saved.data.version);
    if (!r.ok) return failure(r.errorKey);
  }
  revalidatePath('/', 'layout');
  if (!d.id) redirect(`/${d.locale}/admin/news/${saved.data.id}?saved=1`);
  return success(status ? 'news2.admin.statusDone' : 'news2.admin.saved');
}
