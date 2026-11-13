'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { failure, success, type FormState } from '@/lib/form-state';
import { localeSchema, uuidSchema } from '@/lib/schemas';
import { actionUser } from '@/server/action-user';
import { archiveProduct, PRODUCT_UNITS, saveProduct, submitProduct } from '@/server/services/biz-products';

const schema = z.object({
  locale: localeSchema,
  orgId: uuidSchema,
  id: z.preprocess((v) => (v === '' || v == null ? undefined : v), uuidSchema.optional()),
  version: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).optional()),
  kind: z.enum(['product', 'service']),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  price: z.string().trim().max(20).optional(),
  unit: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.enum(PRODUCT_UNITS).optional()),
  minOrder: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(1_000_000).optional()),
  askQuote: z.preprocess((v) => v === 'on', z.boolean()),
  intent: z.enum(['draft', 'submit']),
});

/** Save a product or service as a draft, or save and send it for MITRA review. */
export async function saveProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const raw = Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === 'string'));
  const p = schema.safeParse(raw);
  if (!p.success) return failure('invalid_input', { name: String(raw.name ?? ''), description: String(raw.description ?? ''), price: String(raw.price ?? '') });
  const d = p.data;
  let cents: number | null = null;
  if (!d.askQuote && d.price) {
    const n = Number(d.price.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return failure('invalid_input');
    cents = Math.round(n * 100);
  }
  if (d.intent === 'submit' && !d.askQuote && cents === null) return failure('price_required');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const saved = await saveProduct(
    supabase,
    d.orgId,
    d.id ?? null,
    { kind: d.kind, name: d.name, description: d.description ?? '', price_cents: cents, unit: d.unit ?? '', min_order: d.minOrder ?? '', ask_for_quote: d.askQuote },
    d.version ?? null,
  );
  if (!saved.ok) return failure(saved.errorKey);
  if (d.intent === 'submit') {
    const sent = await submitProduct(supabase, d.orgId, saved.data.id, saved.data.version);
    if (!sent.ok) return failure(sent.errorKey);
  }
  revalidatePath(`/${d.locale}/orgs/${d.orgId}/business/products`);
  return success(d.intent === 'submit' ? 'biz2.products.submitted' : 'biz2.products.saved');
}

export async function archiveProductAction(_prev: FormState, f: FormData): Promise<FormState> {
  const orgId = uuidSchema.safeParse(f.get('orgId'));
  const id = uuidSchema.safeParse(f.get('id'));
  const locale = localeSchema.catch('en').parse(f.get('locale'));
  if (!orgId.success || !id.success) return failure('invalid_input');
  const { supabase, user } = await actionUser();
  if (!user) return failure('unauthenticated');
  const r = await archiveProduct(supabase, orgId.data, id.data);
  if (!r.ok) return failure(r.errorKey);
  revalidatePath(`/${locale}/orgs/${orgId.data}/business/products`);
  return success('biz2.products.removed');
}
