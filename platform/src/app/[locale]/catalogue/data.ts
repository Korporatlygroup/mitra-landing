import { cache } from 'react';
import { uuidSchema } from '@/lib/schemas';
import { getCatalogueItem, listSavedProducts } from '@/server/services/p5-buyer';
import type { Db } from '@/server/services/result';
import { getOptionalUser } from '@/server/session';

/** The product the database currently shows to this caller, or null (hidden, unpublished, suspended, malformed id). Once per request. */
export const loadItem = cache(async (id: string) => {
  if (!uuidSchema.safeParse(id).success) return null;
  const { supabase } = await getOptionalUser();
  if (!supabase) return null;
  const r = await getCatalogueItem(supabase, id);
  return r.ok ? r.data : null;
});

/** Ids of the signed-in buyer's saved products (all pages, bounded). Empty for anonymous users or when the list cannot be read. */
export async function savedIdSet(db: Db | null, signedIn: boolean): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!db || !signedIn) return ids;
  let offset = 0;
  for (let i = 0; i < 12; i++) {
    const r = await listSavedProducts(db, offset);
    if (!r.ok || r.data.items.length === 0) break;
    for (const row of r.data.items) ids.add(row.product_id);
    offset += r.data.items.length;
    if (offset >= r.data.total) break;
  }
  return ids;
}
