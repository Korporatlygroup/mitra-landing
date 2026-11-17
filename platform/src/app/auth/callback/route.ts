import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSiteUrl } from '@/lib/env';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';

const otpTypes = ['email', 'signup', 'recovery', 'invite', 'magiclink', 'email_change'] as const satisfies readonly EmailOtpType[];
const querySchema = z.object({ token_hash: z.string().min(8).max(512), type: z.enum(otpTypes) });

function origin(request: NextRequest): string {
  try {
    return getSiteUrl();
  } catch {
    return request.nextUrl.origin;
  }
}

/**
 * Email confirmation landing point (outside the locale prefix). Verifies the token hash, then redirects to
 * `next` only when it is a same-origin relative path; anything else falls back to "/".
 */
export async function GET(request: NextRequest) {
  const base = origin(request);
  const params = request.nextUrl.searchParams;
  const next = safeRedirectPath(params.get('next'), '/');
  const parsed = querySchema.safeParse({ token_hash: params.get('token_hash'), type: params.get('type') });
  const failed = () => NextResponse.redirect(new URL('/login?error=link_invalid', base));
  if (!parsed.success) return failed();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error) return failed();

  // Recovery links always land on the reset page (the `next` parameter is ignored for them).
  if (parsed.data.type === 'recovery') return NextResponse.redirect(new URL('/reset-password', base));

  // Seller intent from "List your business": after the first email confirmation, a person with no business goes straight to business
  // onboarding. The intent is a routing hint stored at sign-up; it grants nothing, and a person who already has a business is not redirected.
  if (next === '/' && (parsed.data.type === 'email' || parsed.data.type === 'signup')) {
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.user_metadata as { intent?: unknown; language?: unknown } | undefined;
    if (data.user && meta?.intent === 'sell') {
      const { data: orgs } = await supabase.from('memberships').select('org_id, organisations!inner(type)').eq('user_id', data.user.id).eq('status', 'active');
      const hasBusiness = (orgs ?? []).some((m) => (m as unknown as { organisations: { type: string } }).organisations?.type === 'business');
      const lang = meta.language === 'ms' || meta.language === 'ta' ? meta.language : 'en';
      if (!hasBusiness) return NextResponse.redirect(new URL(`/${lang}/orgs/new?purpose=sell`, base));
    }
  }
  return NextResponse.redirect(new URL(next, base));
}
