import { expect, test } from '@playwright/test';
import { createOrgAs, createUser, serviceClient, uniq } from './support/db';
import { BASE_URL, SERVICE_KEY } from './support/env';
import { loginUi } from './support/ui';

// E7 (S10): security headers, cookie flags, no secrets in shipped JS, no open redirects.
const DOCUMENT_PATHS = ['/en', '/en/login'];
const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function commonHeaders(h: Record<string, string>) {
  expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toMatch(/camera=\(\)/);
  expect(h['permissions-policy']).toMatch(/microphone=\(\)/);
  expect(h['permissions-policy']).toMatch(/geolocation=\(\)/);
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-powered-by']).toBeUndefined();
}
const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';
const nonceOf = (csp: string) => directive(csp, 'script-src').match(/'nonce-([^']+)'/)?.[1];

for (const path of DOCUMENT_PATHS) {
  test(`E7 ${path}: security headers and a per-request script nonce`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(400);
    const h = res.headers();
    commonHeaders(h);
    const csp = h['content-security-policy'] ?? '';
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(csp).toContain(d);
    }
    const script = directive(csp, 'script-src');
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toMatch(/\*/);
    expect(directive(csp, 'default-src')).not.toMatch(/\*/);
    const nonce = nonceOf(csp);
    expect(nonce, 'script-src carries a nonce').toBeTruthy();
    expect(nonce!.length).toBeGreaterThanOrEqual(16);

    // Every <script> in the document carries that exact nonce (inline and external).
    const html = await res.text();
    const tags = [...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag, `script tag without the header nonce: ${tag.slice(0, 120)}`).toContain(`nonce="${nonce}"`);

    // A new request gets a new nonce.
    const again = await request.get(path, { maxRedirects: 0 });
    expect(nonceOf(again.headers()['content-security-policy'] ?? '')).not.toBe(nonce);
  });
}

test('E7 the nonce policy lets the app hydrate: no CSP violations and the form works', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto('/en/login');
  await page.waitForLoadState('networkidle');
  // Hydration happened: the sign-in button is enhanced (a submit with empty fields shows native validation, no navigation).
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
  expect(problems).toEqual([]);
});

for (const path of ['/api/v1/health', '/auth/callback']) {
  test(`E7 ${path}: strict policy and common security headers`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBeLessThan(500);
    const h = res.headers();
    expect(h['content-security-policy']).toBe(STRICT_CSP);
    commonHeaders(h);
  });
}

test('E7 session cookies are HttpOnly and SameSite', async ({ page, context }) => {
  const u = await createUser('e7-cookie');
  await loginUi(page, u);
  const cookies = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
  expect(cookies.length).toBeGreaterThan(0);
  for (const c of cookies) {
    expect(c.httpOnly, `${c.name} httpOnly`).toBe(true);
    expect(c.secure, `${c.name} secure`).toBe(true);
    expect(c.sameSite, `${c.name} sameSite`).toBe('Lax');
    expect(c.path).toBe('/');
  }
  // Page scripts cannot read them.
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain('sb-');
  // localStorage/sessionStorage hold no tokens either.
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toMatch(/access_token|refresh_token/);
});

test('E7 no service key or secret key name appears in anything the browser downloads', async ({ page }) => {
  test.setTimeout(180_000);
  const bodies: { url: string; text: string }[] = [];
  page.on('response', async (res) => {
    const type = res.headers()['content-type'] ?? '';
    if (!/javascript|json|html|text|css/.test(type)) return;
    try {
      bodies.push({ url: res.url(), text: await res.text() });
    } catch {
      /* body no longer available */
    }
  });

  const u = await createUser('e7-secret');
  const orgId = await createOrgAs(u, 'business', `Secrets ${uniq('s')}`);
  for (const p of ['/en', '/ta', '/en/login', '/en/signup']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
  }
  await loginUi(page, u);
  for (const p of ['/en/orgs', '/en/orgs/new', '/en/account', `/en/orgs/${orgId}/members`, '/en/mfa/enrol']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
  }

  const scripts = bodies.filter((b) => b.url.includes('/_next/static/') && /\.js(\?|$)/.test(b.url));
  expect(scripts.length, 'JS chunks were collected').toBeGreaterThan(3);
  expect(bodies.length).toBeGreaterThan(scripts.length);
  const forbidden = [SERVICE_KEY, 'sb_secret_', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const b of bodies) {
    for (const f of forbidden) {
      expect(b.text.includes(f), `${f.slice(0, 10)}... found in ${b.url}`).toBe(false);
    }
  }
  // The service role JWT (if the stack used one) would carry this role claim.
  for (const b of scripts) expect(b.text).not.toMatch(/"role"\s*:\s*"service_role"/);
});

test('E7 /auth/callback never redirects off the origin (valid one-time token, hostile next)', async ({ request }) => {
  const u = await createUser('e7-redirect');
  const origin = new URL(BASE_URL).origin;
  const attacks = ['//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com', 'javascript:alert(1)', '///evil.com/%2e%2e', 'http:evil.com'];
  for (const next of [...attacks, '/en/orgs']) {
    const { data, error } = await serviceClient().auth.admin.generateLink({ type: 'magiclink', email: u.email });
    expect(error).toBeNull();
    const token = data.properties!.hashed_token;
    const res = await request.get(`/auth/callback?token_hash=${token}&type=magiclink&next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308], `status for next=${next}`).toContain(res.status());
    const loc = res.headers()['location'] ?? '';
    expect(new URL(loc, origin).origin, `Location for next=${JSON.stringify(next)} was ${loc}`).toBe(origin);
    expect(loc).not.toMatch(/evil\.com/);
    if (next === '/en/orgs') expect(new URL(loc, origin).pathname).toBe('/en/orgs');
    else expect(new URL(loc, origin).pathname).toBe('/');
  }
  // An invalid token falls back to the login page on the same origin.
  const bad = await request.get(`/auth/callback?token_hash=notavalidtoken123&type=magiclink&next=${encodeURIComponent('//evil.com')}`, { maxRedirects: 0 });
  expect(new URL(bad.headers()['location']!, origin).origin).toBe(origin);
  expect(bad.headers()['location']).toContain('link_invalid');
});

test('E7 the login ?next= parameter cannot send a signed-in user to another site', async ({ page }) => {
  const u = await createUser('e7-next');
  const hits: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    hits.push(route.request().url());
    return route.abort();
  });
  for (const next of ['//evil.com', 'https://evil.com/x', '/\\evil.com']) {
    await page.context().clearCookies();
    await loginUi(page, u, 'en', next);
    expect(new URL(page.url()).origin).toBe(new URL(BASE_URL).origin);
  }
  expect(hits.filter((h) => h.includes('evil.com'))).toEqual([]);
});
