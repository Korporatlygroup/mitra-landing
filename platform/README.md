# MITRA platform (Phase 1: core platform foundation)

Next.js 16 (App Router) + Supabase (Auth, Postgres, RLS). English and Tamil (`/en`, `/ta`).
Authorisation lives in the database (RLS + RPCs in `supabase/migrations`); the app never trusts UI state.

## Run locally

```bash
npm install
npm run db:start                  # local Supabase (API 54421, DB 54422, Mailpit 54424/54425)
node scripts/write-local-env.mjs  # writes .env.local (gitignored) from `supabase status`
npm run dev                       # http://127.0.0.1:3000
```

Confirmation and invitation emails are captured by Mailpit: http://127.0.0.1:54424

### First administrator (single use)

Sign up and confirm an account first, then:

```bash
node scripts/bootstrap-admin.mjs --email you@example.com
```

Refuses to run unless the API host is `127.0.0.1`/`localhost`, or `--allow-remote` is passed **and**
`MITRA_BOOTSTRAP_CONFIRM` equals the exact email. Admins must enrol an authenticator app on next sign-in.

## Checks

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

`test:unit` needs no network. `test:integration` and `test:db` need the local stack.

## Layout

| Path | Purpose |
|---|---|
| `src/app/[locale]/**` | Pages; `actions.ts` files are thin server actions (Zod, call a service, map the error, redirect) |
| `src/app/auth/callback`, `src/app/api/v1/health` | Outside the locale prefix |
| `src/server/services/*.ts` | Business logic as plain functions that take a Supabase client |
| `src/server/session.ts` | `requireSession()`: the one gate for protected pages (login, then MFA when required) |
| `src/server/privileged.ts` | The only module that reads the service key (`recordAuthEvent`); imported only by actions and route handlers |
| `src/server/mailer.ts` | SMTP mailer (`SMTP_URL`, `MAIL_FROM`); throws in production if unset |
| `src/lib/schemas.ts` | All Zod schemas (issue messages are keys in `errors.*`) |
| `src/lib/permissions.ts` | Role to permission map, checked against the SQL seed by a unit test |
| `src/lib/errors.ts` | Maps RPC error codes/keys to translated messages |
| `messages/{en,ta}.json` | All user-visible text. Tamil is a draft and needs native review |

## Security notes

- Session cookies: HttpOnly, SameSite=Lax, Secure on https. All auth runs on the server.
- MFA (TOTP) is required for any `admin_*` membership and for owners of partner organisations before
  organisation-management and admin pages; the database also checks `aal2` in `has_permission`.
- Login errors are generic; sign-up looks the same whether or not the email exists.
- Sign-in, MFA and sign-up audit events are written by database triggers; the app records only logout and password change.
- Login, MFA, sign-up and password-reset attempts are throttled per account through `service_auth_attempt` (fails closed).
- CSP uses a per-request nonce set in `src/proxy.ts` (pages are all dynamic); styles keep `'unsafe-inline'`.
- Invitation tokens are shown once by the RPC, emailed, and never stored or logged by the app.
