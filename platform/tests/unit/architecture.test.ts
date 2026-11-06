import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, read, walk } from './helpers';

const srcFiles = walk(path.join(ROOT, 'src')).map((f) => path.relative(ROOT, f).replaceAll('\\', '/'));

describe('privileged (service-role) boundary', () => {
  it('privileged.ts is imported only by server actions and route handlers', () => {
    const offenders = srcFiles.filter((f) => {
      if (f === 'src/server/privileged.ts') return false;
      const imports = /from\s+['"](@\/server\/privileged|(\.{1,2}\/)+(server\/)?privileged)['"]/.test(read(f));
      return imports && !/(\/actions\.ts|\/route\.ts)$/.test(f);
    });
    expect(offenders).toEqual([]);
  });

  it('at least one action actually uses it', () => {
    const users = srcFiles.filter((f) => f !== 'src/server/privileged.ts' && read(f).includes('@/server/privileged'));
    expect(users.length).toBeGreaterThan(0);
  });

  it('privileged.ts guards against client bundling', () => {
    expect(read('src/server/privileged.ts')).toMatch(/^import 'server-only';/m);
  });

  it('privileged.ts exposes exactly recordAuthEvent and authAttempt', () => {
    const exported = [...read('src/server/privileged.ts').matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(exported).toEqual(['recordAuthEvent', 'authAttempt']);
  });

  it('the app records only the two events the database cannot observe (login/MFA/signup are DB-derived)', () => {
    expect(read('src/server/privileged.ts')).toMatch(/AuthEventAction = 'auth\.logout' \| 'auth\.password_changed'/);
    for (const f of srcFiles) {
      for (const m of read(f).matchAll(/recordAuthEvent\([^,]+,\s*'([a-z_.]+)'/g)) {
        expect(['auth.logout', 'auth.password_changed'], `${f}: ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it('login, sign-up, forgot-password and MFA actions throttle through authAttempt before touching GoTrue', () => {
    const order = (file: string, first: string, second: string) => {
      const t = read(file);
      expect(t, file).toContain('authAttempt(');
      expect(t.indexOf('authAttempt('), file).toBeLessThan(t.indexOf(second));
      void first;
    };
    order('src/app/[locale]/login/actions.ts', 'authAttempt', 'signIn(supabase');
    order('src/app/[locale]/signup/actions.ts', 'authAttempt', 'signUp(supabase');
    order('src/app/[locale]/forgot-password/actions.ts', 'authAttempt', 'requestPasswordReset(supabase');
    order('src/app/[locale]/mfa/verify/actions.ts', 'authAttempt', 'verifyTotp(supabase');
    order('src/app/[locale]/mfa/enrol/actions.ts', 'authAttempt', 'verifyTotp(supabase');
  });

  it('no server code reads identity from the session object (getSession)', () => {
    const offenders = srcFiles.filter((f) => /auth\.getSession\(|getAuthenticatorAssuranceLevel\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the secret/service key name appears only in privileged.ts inside src', () => {
    const offenders = srcFiles.filter((f) => f !== 'src/server/privileged.ts' && /SUPABASE_SECRET_KEY|SERVICE_ROLE|sb_secret_/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('client components never import server-only modules', () => {
    const offenders = srcFiles.filter((f) => {
      const text = read(f);
      return /^['"]use client['"]/m.test(text) && /server\/privileged|server\/mailer|supabase\/server/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe('public environment variables', () => {
  it('no NEXT_PUBLIC_ variable name contains SECRET or SERVICE', () => {
    const files = [...srcFiles, 'next.config.ts', '.env.example', 'scripts/bootstrap-admin.mjs', 'scripts/write-local-env.mjs'];
    const bad: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]*/g)) {
        if (/SECRET|SERVICE/i.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('.env.example documents every variable the code reads', () => {
    const example = read('.env.example');
    for (const v of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SITE_URL', 'SMTP_URL', 'MAIL_FROM', 'MAILPIT_URL']) {
      expect(example, v).toMatch(new RegExp(`^${v}=`, 'm'));
    }
  });
});

describe('pages use the session gate', () => {
  it('every protected page calls requireSession', () => {
    const protectedPages = ['account', 'orgs', 'orgs/new', 'orgs/[id]/members', 'admin/users', 'admin/audit', 'mfa/enrol', 'mfa/verify'];
    for (const p of protectedPages) {
      expect(read(`src/app/[locale]/${p}/page.tsx`), p).toContain('requireSession(');
    }
  });
});
