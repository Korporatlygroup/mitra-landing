/** Non-secret environment access. The service key is NOT read here (only in src/server/privileged.ts). */

export function getSiteUrl(): string {
  const v = process.env.SITE_URL;
  if (v) return v.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SITE_URL is not configured');
  }
  return 'http://127.0.0.1:3000';
}

export function getSupabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  return v;
}

export function getSupabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured');
  return v;
}
