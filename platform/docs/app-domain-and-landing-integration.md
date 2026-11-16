# `app.inok.my` and landing-page integration (prepared, NOT activated)

State on 2026-11-16: no route, no DNS record and no landing-page change exists. `inok-app-production` answers only on its workers.dev address behind the access key. `inok.my` (Worker `mitra-landing`) is untouched.

## What is already in place
- Production Worker `inok-app-production`, built against `inok-production` only, `ACCESS_GATE=required`, no custom domain.
- Production Auth: Site URL `https://app.inok.my`, redirect list `https://app.inok.my/auth/callback` plus the private Worker callback, public sign-up off.
- Build guard: `scripts/cf-build.mjs` refuses a production build that points at the staging project.

## Activation in two separate steps (each needs your explicit go)
Keeping the steps apart means attaching the domain does **not** open the application to the public.

### Step 1: attach the domain, still gated (needs DNS approval)
1. Cloudflare dashboard, Workers & Pages, `inok-app-production`, Settings, Domains & Routes, Add, **Custom domain** `app.inok.my` (the `inok.my` zone is in the same account; this creates the DNS record, which is the DNS change that needs your approval). Or in `wrangler.production.jsonc` add `"routes": [{ "pattern": "app.inok.my", "custom_domain": true }]` and redeploy with `npx wrangler deploy -c wrangler.production.jsonc`.
2. Change the Worker variable `SITE_URL` to `https://app.inok.my` (it is a runtime variable, no rebuild). Redeploy.
3. Leave `ACCESS_GATE=required`. Verify: `https://app.inok.my/en` answers 401 without the key, 200 with it; `https://app.inok.my/api/v1/health` answers 200.
4. Do the same for `staging.inok.my` if wanted, with `SITE_URL` for staging and the staging Supabase redirect list updated through `deploy/supabase-auth/staging.toml`.

### Step 2: open to the public (launch day, after every blocker below is closed)
1. Release gates in `launch-checklist.md` signed.
2. Change `ACCESS_GATE` to `off` (or remove the variable and gate) and redeploy.
3. Decide separately whether to enable public sign-up (`deploy/supabase-auth/production.toml`, `enable_signup`): it stays **off** until a transactional mail provider delivers confirmation mail.
4. Only then the landing page change below.

## Landing-page integration (a pull request to `mitra-landing`, not made)
Rule: no change to the live page until launch day. Prepare the change in a branch of `mitra-landing` and review the preview (note: Workers Builds currently fail on non-production branches of that repo; check that first).

| Landing label | Link | Notes |
|---|---|---|
| Register Your Business | `https://app.inok.my/en/signup` | wording: starts an INOK listing review, not government enrolment |
| Sign In | `https://app.inok.my/en/login` | `?next=` accepts same-origin paths only |
| Explore Businesses | `https://app.inok.my/en/directory` | public, no sign-in |
| Business Support | `https://app.inok.my/en/business-help` | public; says INOK is not a government agency |

Use `/ms/` and `/ta/` prefixes to match the visitor's language. All copy stays in `content/site.json` per the landing repo rules; do not hard-code the URLs in components. `inok.my` itself stays on the `mitra-landing` Worker; `app.inok.my` is a different hostname, so the two deploy independently.

## Rollback
Remove the custom domain (Domains & Routes) or set `ACCESS_GATE=required` again and redeploy; the landing links are reverted by reverting the landing pull request.
