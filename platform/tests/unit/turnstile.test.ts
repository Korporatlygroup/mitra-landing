import { afterEach, describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ms from '../../messages/ms.json';
import ta from '../../messages/ta.json';
import { buildCsp } from '../../src/lib/csp';
import { CAPTCHA_FIELD, captchaEnabled, captchaTokenFrom, TURNSTILE_ORIGIN } from '../../src/lib/turnstile';
import { requestPasswordReset, signIn, signUp } from '../../src/server/services/auth';

// Turnstile is OFF unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set: with it off nothing may change for any user.
const KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
afterEach(() => { if (KEY === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = KEY; });

describe('captcha flag and token', () => {
  it('is off by default and on only with a site key', () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    expect(captchaEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    expect(captchaEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '   ';
    expect(captchaEnabled()).toBe(false);
  });
  it('reads the token from the form, ignoring empty, oversized and non-text values', () => {
    const fd = (v: FormDataEntryValue | null) => { const f = new FormData(); if (v !== null) f.set(CAPTCHA_FIELD, v); return f; };
    expect(captchaTokenFrom(fd('tok'))).toBe('tok');
    expect(captchaTokenFrom(fd(''))).toBeUndefined();
    expect(captchaTokenFrom(fd('x'.repeat(5000)))).toBeUndefined();
    expect(captchaTokenFrom(fd(null))).toBeUndefined();
    expect(captchaTokenFrom(fd(new File(['a'], 'a.txt')))).toBeUndefined();
  });
});

describe('the CSP allows the challenge only when captcha is on', () => {
  const base = { nonce: 'n', isDev: false, supabaseOrigin: 'https://x.supabase.co' };
  it('off: no Cloudflare origin anywhere', () => {
    expect(buildCsp(base)).not.toContain('cloudflare');
    expect(buildCsp(base)).not.toContain('frame-src');
  });
  it('on: script and frame only from the challenge origin, everything else unchanged', () => {
    const on = buildCsp({ ...base, captchaOrigin: TURNSTILE_ORIGIN });
    expect(on).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(on).toContain(`frame-src ${TURNSTILE_ORIGIN}`);
    expect(on).toContain("default-src 'self'");
    expect(on).toContain("frame-ancestors 'none'");
    expect(on).not.toMatch(/connect-src [^;]*cloudflare/);
  });
});

describe('the token reaches Supabase Auth only when present, and a rejected token has its own message', () => {
  const seen: Record<string, unknown> = {};
  const db = (error: { code?: string; status?: number } | null) => ({ auth: {
    signUp: async (a: unknown) => { seen.signUp = a; return { error }; },
    signInWithPassword: async (a: unknown) => { seen.signIn = a; return { error }; },
    resetPasswordForEmail: async (e: string, o: unknown) => { seen.reset = o; return { error }; },
  } }) as never;
  const su = { email: 'a@example.test', password: 'Abcdefghi1', displayName: 'A', language: 'en' as const, redirectTo: 'http://x/cb', consentVersion: '2026-07', marketing: false };
  it('sign-up', async () => {
    await signUp(db(null), { ...su, captchaToken: 'tok' });
    expect((seen.signUp as { options: { captchaToken?: string } }).options.captchaToken).toBe('tok');
    await signUp(db(null), su);
    expect((seen.signUp as { options: { captchaToken?: string } }).options).not.toHaveProperty('captchaToken');
    const r = await signUp(db({ code: 'captcha_failed', status: 400 }), { ...su, captchaToken: 'bad' });
    expect(r.ok ? 'ok' : r.errorKey).toBe('captcha_failed');
  });
  it('sign-in', async () => {
    await signIn(db(null), 'a@example.test', 'pw', 'tok');
    expect((seen.signIn as { options?: { captchaToken?: string } }).options?.captchaToken).toBe('tok');
    await signIn(db(null), 'a@example.test', 'pw');
    expect(seen.signIn).not.toHaveProperty('options');
    expect((await signIn(db({ code: 'captcha_failed' }), 'a@example.test', 'pw', 'bad')).ok).toBe(false);
    const wrong = await signIn(db({ code: 'invalid_credentials', status: 400 }), 'a@example.test', 'pw');
    expect(wrong.ok ? 'ok' : wrong.errorKey).toBe('login_failed'); // still the same generic message
  });
  it('password reset still never reveals anything', async () => {
    expect((await requestPasswordReset(db({ code: 'captcha_failed' }), 'a@example.test', 'http://x/cb', 'bad')).ok).toBe(true);
    await requestPasswordReset(db(null), 'a@example.test', 'http://x/cb', 'tok');
    expect((seen.reset as { captchaToken?: string }).captchaToken).toBe('tok');
  });
  it('the message exists in English, Malay and Tamil', () => {
    for (const m of [en, ms, ta]) expect((m as { errors: Record<string, string> }).errors.captcha_failed).toBeTruthy();
  });
});
