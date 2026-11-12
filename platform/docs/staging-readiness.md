# Hosted staging readiness (state on 2026-11-10; verified read-only, nothing changed)

| Area | State | Evidence / action needed |
|---|---|---|
| Supabase project | Active, ap-southeast-1, Postgres 17 | `supabase projects list` |
| Schema | Phase 1+2 present (11 migrations, content identical to repo); Phase 3 not applied | see `staging-migration-reconciliation.md` |
| Data | 0 users, 0 organisations | read-only query |
| Storage | one bucket `verification-docs`, private, 10 MiB | read-only query. No public bucket exists (needed for portfolio images). |
| App hosting | **None configured.** No `vercel.json`, no Vercel CLI login, no GitHub Actions secrets or environments, no staging URL | needs owner decision (Vercel or Cloudflare) and account access |
| Env vars needed | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (server only), `SITE_URL`, `SMTP_URL`, `MAIL_FROM`, `CLAMD_HOST`/`CLAMD_PORT` | from `.env.example`; secret key must not have a public prefix. Never put in GitHub or logs. |
| Auth config | Not inspected in the dashboard (no API access used). Needs: Site URL and redirect URLs set to the staging origin, email confirmations, SMTP provider, MFA enabled | owner action in Supabase dashboard |
| HTTPS / domain | None | follows hosting decision |
| Error monitoring | None configured | dependency |
| Malware scanner | **Not configured.** Code uses ClamAV via `CLAMD_HOST`; when unset, uploads stay in private quarantine with status pending and nobody can open them. | This is a quarantine fallback, not malware scanning. Recorded as a launch dependency. Hosted verification-document tests must expect "pending" only. |
| Hosted test run | **Not run.** Needs the app deployed, auth settings and the reconciliation done first. Test plan: signup/login, session persistence, org + roles, seller registration, profile edit, document upload (stays pending), reviewer approve/reject (needs a scan result or a documented reviewer path), MFA, cross-org denial, audit entries, using synthetic accounts only | blocked on the items above |

Note: the existing Phase 1-3 browser suite (262 tests) can be pointed at a deployed URL, but it assumes a local Mailpit mailbox and a clean database, so it should not be run against hosted staging unchanged.
