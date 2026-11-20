import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ms from '../../messages/ms.json';
import ta from '../../messages/ta.json';
import { signUp } from '../../src/server/services/auth';

// Production sends Auth mail through custom SMTP (Resend). If the provider refuses or fails (unverified domain, revoked key, outage, or custom SMTP switched off so the
// built-in sender only serves team addresses), Supabase returns these errors.
// A person who signs up must be told plainly, not shown "something went wrong", and the existing privacy behaviour must not change.
const args = { email: 'a@example.test', password: 'Abcdefghi1', displayName: 'A', language: 'en' as const, redirectTo: 'http://x/auth/callback', consentVersion: '2026-07', marketing: false };
const db = (error: { code?: string; status?: number; message?: string } | null) => ({ auth: { signUp: async () => ({ error }) } }) as never;
const key = async (e: Parameters<typeof db>[0]) => { const r = await signUp(db(e), args); return r.ok ? 'ok' : r.errorKey; };

describe('sign-up when the confirmation email cannot be sent', () => {
  it('says so plainly for an address the project may not email, a disabled provider and a provider error', async () => {
    expect(await key({ code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' })).toBe('email_unavailable');
    expect(await key({ code: 'email_provider_disabled', status: 400 })).toBe('email_unavailable');
    expect(await key({ code: 'unexpected_failure', status: 500, message: 'Error sending confirmation email' })).toBe('email_unavailable');
  });
  it('keeps the existing behaviour for everything else', async () => {
    expect(await key(null)).toBe('ok');
    expect(await key({ code: 'user_already_exists', status: 422 })).toBe('ok'); // identical to a fresh sign-up: no account probing
    expect(await key({ code: 'weak_password', status: 422 })).toBe('password_weak');
    expect(await key({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited');
    expect(await key({ code: 'something_else', status: 500, message: 'boom' })).toBe('internal');
  });
  it('the message exists in English, Malay and Tamil', () => {
    for (const m of [en, ms, ta]) expect((m as { errors: Record<string, string> }).errors.email_unavailable).toBeTruthy();
  });
});
