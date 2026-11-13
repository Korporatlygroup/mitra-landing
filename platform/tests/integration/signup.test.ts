import { afterAll, describe, expect, it } from 'vitest';
import {
  RFC6238_SECRET_B32,
  anonClient,
  cleanupUsers,
  deleteEmailsTo,
  sql,
  strongPassword,
  totp,
  trackUser,
  uniqEmail,
  waitForEmail,
} from './helpers';

afterAll(cleanupUsers);

describe('totp generator', () => {
  it('matches the RFC 6238 Appendix B SHA-1 test vectors', () => {
    expect(totp(RFC6238_SECRET_B32, 59_000, 8)).toBe('94287082');
    expect(totp(RFC6238_SECRET_B32, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(RFC6238_SECRET_B32, 20_000_000_000_000, 8)).toBe('65353130');
  });
});

describe('(a) sign-up with email confirmation, using only local services', () => {
  const email = uniqEmail('signup');
  const password = strongPassword();

  it('signs up with consents, blocks sign-in until confirmed, then confirms through the emailed token_hash link', async () => {
    await deleteEmailsTo(email);
    const client = anonClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: 'Synthetic Tester', language: 'ta', consents: { terms: '2026-07', privacy: '2026-07' } },
        emailRedirectTo: 'http://127.0.0.1:3000/auth/callback',
      },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    trackUser(data.user!.id);
    // email confirmations are on: no session is issued at sign-up
    expect(data.session).toBeNull();

    // the unconfirmed user cannot sign in
    const attempt = await anonClient().auth.signInWithPassword({ email, password });
    expect(attempt.data.session).toBeNull();
    expect(attempt.error?.code).toBe('email_not_confirmed');

    // the profile and consent rows are created by the DB trigger straight away
    const profile = await sql<{ language: string; display_name: string }>(
      'select language, display_name from public.profiles where id = $1',
      [data.user!.id],
    );
    expect(profile).toEqual([{ language: 'ta', display_name: 'Synthetic Tester' }]);

    // read the confirmation email from Mailpit and extract the token_hash link
    const mail = await waitForEmail(email);
    const body = `${mail.html}\n${mail.text}`;
    const match = /token_hash=([^&"'\s<]+)&(?:amp;)?type=email/.exec(body);
    expect(match, 'confirmation email must contain a token_hash link').not.toBeNull();
    const tokenHash = decodeURIComponent(match![1]!);
    // the link points at the app's own callback, not at the Auth server
    expect(body).toContain('/auth/callback?token_hash=');

    const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.access_token).toBeTruthy();

    // the confirmed user now signs in normally
    const ok = await anonClient().auth.signInWithPassword({ email, password });
    expect(ok.error).toBeNull();
    expect(ok.data.session).not.toBeNull();

    // the confirmation token cannot be replayed
    const replay = await anonClient().auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    expect(replay.error).not.toBeNull();
    expect(replay.data.session).toBeNull();

    // consent rows exist (own rows are visible through RLS to the user)
    const consents = await sql<{ purpose: string; version: string }>(
          'select purpose, version from public.consents where user_id = $1 order by purpose',
          [data.user!.id],
    );
    expect(consents).toEqual([
      { purpose: 'privacy', version: '2026-07' },
      { purpose: 'terms', version: '2026-07' },
    ]);
    const audit = await sql<{ n: string }>(
      `select count(*)::text as n from public.audit_log where action = 'consent.granted' and details ->> 'user_id' = $1`,
      [data.user!.id],
    );
    expect(Number(audit[0]!.n)).toBe(2);

    // through the real API, the user sees exactly their own profile and consents
    const authed = ok.data.session!;
    const own = anonClient();
    await own.auth.setSession({ access_token: authed.access_token, refresh_token: authed.refresh_token });
    const apiConsents = await own.from('consents').select('purpose');
    expect(apiConsents.error).toBeNull();
    expect(apiConsents.data).toHaveLength(2);
    const apiProfiles = await own.from('profiles').select('id, language');
    expect(apiProfiles.data).toEqual([{ id: data.user!.id, language: 'ta' }]);
  });

  it('defaults unknown language to en and records no consent for a non-current version (1999-01)', async () => {
    const e2 = uniqEmail('signup2');
    const { data, error } = await anonClient().auth.signUp({
      email: e2,
      password: strongPassword(),
      options: { data: { language: 'xx', consents: { terms: '1999-01', privacy: '2026-07' } } },
    });
    expect(error).toBeNull();
    trackUser(data.user!.id);
    const rows = await sql<{ language: string }>('select language from public.profiles where id = $1', [data.user!.id]);
    expect(rows[0]!.language).toBe('en');
    const c = await sql<{ purpose: string }>('select purpose from public.consents where user_id = $1', [data.user!.id]);
    expect(c.map((r) => r.purpose)).toEqual(['privacy']);
  });
});
