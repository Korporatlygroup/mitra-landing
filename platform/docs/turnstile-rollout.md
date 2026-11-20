# Cloudflare Turnstile for public registration: rollout plan (code ready, OFF, nothing enabled)

Purpose: stop automated sign-ups from using up the Resend daily cap (100 per day on the Free plan) and the Supabase hourly email limit (30 per hour, verified read-only on 2026-11-20), and from filling the database with junk accounts. Production today: sign-up open, **captcha disabled** (verified read-only).

## What the code does (this PR)
- Off unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set at **build** time. With it off, no widget, no token, no extra CSP origin: behaviour is identical to today (unit-tested).
- With it on: a security check appears on sign-up, sign-in and password reset; the one-time token is sent with the form and passed to Supabase Auth (`captchaToken`). The app refuses a missing token with a translated message (English, Malay, Tamil) before calling Supabase. A token a person has used is renewed after every submit. The CSP gains Cloudflare's challenge origin for scripts and frames only.
- Password reset keeps its neutral answer: nothing reveals whether an address exists.
- Not covered by Turnstile: the email-link callback (`verifyOtp`), invitations acceptance for people who are already signed in, MFA.

## Local verification done (Cloudflare's test keys, local stack only)
Built with the always-passes test site key and local Supabase captcha enabled with the test secret: sign-up reached "check your email" and created the user; the same form with the token emptied was refused with the security-check message; sign-in succeeded with a token; reset stayed neutral; desktop and phone. Test: `tests/e2e/e106-turnstile.spec.ts` (opt-in: `E2E_TURNSTILE=1`, needs internet and the local captcha setting). Unit: 12 new cases (flag, token handling, CSP on/off, token pass-through to all three calls, error mapping, translations). Normal CI runs with Turnstile off.
**Not verified:** a real Turnstile widget with a production site key against production Supabase; behaviour behind an ad blocker or in a browser that blocks third-party frames (the person would be told to complete the check and could not: see risk below).

## Rollout steps (all need approval; none done)
1. **Cloudflare** (owner): Dashboard > Turnstile > Add widget; name "INOK sign-up"; domains `app.inok.my` (add `inok-app-production.long-wind-0982.workers.dev` only if that address must work); mode Managed. Note the **site key** (public) and **secret key** (secret).
2. **Supabase** (owner, production setting): Authentication > Attack Protection > enable CAPTCHA, provider Cloudflare Turnstile, paste the secret. **Do this immediately before step 3**, because Supabase will reject every sign-up, sign-in and reset that has no token until the new build is live.
3. **Build and deploy** with the site key: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the production build environment (it is baked at build time), build from the merged commit with the normal procedure, deploy the Worker. Order matters: Worker first would show a widget Supabase ignores (harmless); Supabase first would block everyone until the Worker is live (avoid). Preferred order: **deploy Worker with the key, then enable Supabase captcha** (the app sends tokens already; Supabase starts verifying them).
4. **Verify in production** (read-only plus one authorised test): the widget shows on /signup, /login, /forgot-password in English, Malay and Tamil at 360 px; sign-in of an existing authorised account works; the controlled email-delivery test (see `email-delivery-test-plan.md`) runs with the widget on.
5. **Rollback:** Supabase: turn CAPTCHA off (one switch, immediate). App: redeploy the previous Worker (or rebuild without the key). Either alone is safe: with Supabase off the app still works with tokens; with the app off Supabase must be off too.
## Risks and decisions
- A person whose browser blocks Cloudflare frames cannot register or sign in while it is on; Cloudflare's challenge is usually invisible. Support wording is needed for this case.
- Turnstile is a third party that receives the visitor's IP and browser signals: add Cloudflare Turnstile to the Privacy Notice processors (draft change, not made here) and to the Cookie Notice review (Turnstile may set cookies for the challenge; to be checked on a real widget).
- Decision: enable on sign-up only, or also on sign-in and reset? Supabase applies its captcha setting to all three at once, so the code covers all three.
