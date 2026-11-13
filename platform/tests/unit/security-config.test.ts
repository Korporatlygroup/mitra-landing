import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCsp, newNonce, supabaseOriginFromEnv } from '@/lib/csp';
import { cookieOptionsFor } from '@/lib/supabase/config';
import { LIMITS, emailThrottleKey, mfaThrottleKey } from '@/lib/throttle';
import { requestPasswordReset } from '@/server/services/auth';
import { forgotPasswordSchema } from '@/lib/schemas';
import type { Db } from '@/server/services/result';
import { read } from './helpers';

describe('session cookie options', () => {
  it('are HttpOnly, SameSite=Lax, path /', () => {
    const o = cookieOptionsFor({ siteUrl: 'http://127.0.0.1:3000', nodeEnv: 'development' });
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
  });
  it('are Secure when SITE_URL is https', () => {
    expect(cookieOptionsFor({ siteUrl: 'https://app.example.com', nodeEnv: 'development' }).secure).toBe(true);
    expect(cookieOptionsFor({ siteUrl: ' HTTPS://app.example.com', nodeEnv: 'development' }).secure).toBe(true);
  });
  it('are Secure in production even on an http or missing SITE_URL', () => {
    expect(cookieOptionsFor({ siteUrl: 'http://127.0.0.1:3000', nodeEnv: 'production' }).secure).toBe(true);
    expect(cookieOptionsFor({ nodeEnv: 'production' }).secure).toBe(true);
  });
  it('are never weakened by input', () => {
    for (const siteUrl of [undefined, '', 'http://x', 'https://x']) {
      for (const nodeEnv of [undefined, 'development', 'test', 'production']) {
        const o = cookieOptionsFor({ siteUrl, nodeEnv });
        expect(o.httpOnly).toBe(true);
        expect(o.sameSite).toBe('lax');
      }
    }
  });
});

describe('Content-Security-Policy', () => {
  const nonce = newNonce();
  const prod = buildCsp({ nonce, isDev: false, supabaseOrigin: 'http://127.0.0.1:54421' });
  const dev = buildCsp({ nonce, isDev: true, supabaseOrigin: 'http://127.0.0.1:54421' });
  const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(name + ' ')) ?? '';

  it('uses a nonce with strict-dynamic and no unsafe-inline / unsafe-eval for scripts in production', () => {
    const s = directive(prod, 'script-src');
    expect(s).toContain(`'nonce-${nonce}'`);
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain('unsafe-inline');
    expect(s).not.toContain('unsafe-eval');
  });
  it('allows unsafe-eval only in development', () => {
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });
  it('locks down framing, base, forms and objects and allows the Supabase origin for connect', () => {
    for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "default-src 'self'", "img-src 'self' data:"]) {
      expect(prod).toContain(d);
    }
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self' http://127.0.0.1:54421");
  });
  it('nonces are unique per call and base64', () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
  it('derives the Supabase origin and tolerates garbage', () => {
    expect(supabaseOriginFromEnv('http://127.0.0.1:54421/rest/v1')).toBe('http://127.0.0.1:54421');
    expect(supabaseOriginFromEnv('not a url')).toBe('');
    expect(supabaseOriginFromEnv(undefined)).toBe('');
  });
  it('next.config.ts no longer ships a script-src with unsafe-inline', () => {
    expect(read('next.config.ts')).not.toContain("'unsafe-inline'");
  });
});

describe('throttle keys', () => {
  it('hash the normalised email so no address is stored', () => {
    const expected = createHash('sha256').update('asha@example.com').digest('hex');
    expect(emailThrottleKey('login', ' Asha@Example.COM ')).toBe(`login:${expected}`);
    expect(emailThrottleKey('signup', 'asha@example.com')).toBe(`signup:${expected}`);
    expect(emailThrottleKey('reset', 'asha@example.com')).toBe(`reset:${expected}`);
    expect(emailThrottleKey('login', 'asha@example.com')).not.toContain('asha');
  });
  it('MFA key is per user id', () => {
    expect(mfaThrottleKey('3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34')).toBe('mfa:3f2b8c1e-9d4a-4b6e-8f10-2a7c5d9e1b34');
  });
  it('limits match the contract', () => {
    expect(LIMITS.login).toEqual({ max: 10, windowSeconds: 900 });
    expect(LIMITS.mfa).toEqual({ max: 10, windowSeconds: 900 });
    expect(LIMITS.signup).toEqual({ max: 5, windowSeconds: 3600 });
  });
});

describe('requestPasswordReset (no account enumeration)', () => {
  const client = (impl: () => Promise<{ error: unknown }>) => ({ auth: { resetPasswordForEmail: vi.fn(impl) } }) as unknown as Db;

  it('returns the same ok result for success, "user not found", rate-limit errors and thrown errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcomes = await Promise.all([
      requestPasswordReset(client(async () => ({ error: null })), 'a@b.test', 'http://x/auth/callback'),
      requestPasswordReset(client(async () => ({ error: { code: 'user_not_found', status: 400 } })), 'a@b.test', 'http://x/auth/callback'),
      requestPasswordReset(client(async () => ({ error: { code: 'over_email_send_rate_limit', status: 429 } })), 'a@b.test', 'http://x/auth/callback'),
      requestPasswordReset(client(async () => Promise.reject(new Error('network'))), 'a@b.test', 'http://x/auth/callback'),
    ]);
    for (const o of outcomes) expect(o).toEqual({ ok: true, data: null });
  });

  it('the forgot-password schema only needs a well-formed email', () => {
    expect(forgotPasswordSchema.parse({ email: ' A@B.test ' }).email).toBe('a@b.test');
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('the action never branches on whether the account exists', () => {
    const action = read('src/app/[locale]/forgot-password/actions.ts');
    expect(action).toContain("success('forgot.sent')");
    // The only return statements are the validation failure and the neutral success.
    const returns = [...action.matchAll(/return ([a-zA-Z]+)\(/g)].map((m) => m[1]);
    expect(returns.sort()).toEqual(['failure', 'success']);
  });
});
