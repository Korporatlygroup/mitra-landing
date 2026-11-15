# INOK platform (Phase 1: core platform foundation; formerly named MITRA)

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

## Phase 2: seller onboarding and verification

- Owner screens: `/[locale]/orgs/[id]/business` (overview), `/onboarding?step=1..5`, `/verification`, `/preview`; messages at `/[locale]/notifications`.
- Reviewer screens (admin roles, aal2): `/[locale]/admin/verification` (queue) and `/admin/verification/[claimId]`.
- Wording rule: only "Documents reviewed by INOK ... for: <scope>". Never claim an SSM, official or government check.
  A unit test lints the message files for forbidden phrases.
- Uploads (`src/server/services/documents.ts`): size, extension, declared type and magic bytes must agree; PDFs with active content are
  rejected; the file is scanned BEFORE it is written. Clean files are stored as `clean`; if the scanner is unavailable the file is stored
  privately as `pending` (quarantine, never served) and rescanned later (`POST /api/v1/jobs/rescan` with `CRON_SECRET`, or the
  "Run security scan now" button for reviewers). Infected files are never stored; infected files found later are deleted.
- Downloads: `GET /api/v1/documents/[id]` authorises and logs with the user's session (`get_document_access`), then streams the private object.
- Environment: `CLAMD_HOST`, `CLAMD_PORT`, `CRON_SECRET` (see `.env.example`).

**Launch blockers:** a real ClamAV `clamd` service (and a provider decision for hosting it) must be in place before production uploads are
accepted. Without it every upload stays in quarantine and no reviewer can open it.

### Operations requirements (read before launch)

- **A real ClamAV `clamd` is mandatory.** With `CLAMD_HOST` unset (or clamd unreachable) every upload is accepted into private
  quarantine as `pending`: nobody, including reviewers, can open it and no claim can be submitted with it. Nothing is ever marked clean without a scan.
- **A scheduler must call the rescan route.** Run `POST /api/v1/jobs/rescan` with `Authorization: Bearer $CRON_SECRET` (for example every 5 minutes).
  Each call scans at most 10 documents (`RESCAN_BATCH`) and reports `{checked, clean, infected, waiting, remaining}`; `remaining` is the number still
  unscanned (capped at 100). The same authorized job also cleans abandoned Phase 6 sourcing uploads and sends due sourcing reminders.
  Without `CRON_SECRET` the route answers 404.
- **Upload pipeline order:** validate type and size, strip image metadata (EXIF, XMP, comments, text chunks), hash, scan, store, register. The scanned
  buffer is exactly the stored buffer and the sha256 is of the stored bytes. At most 4 clamd connections are open per process.
- **Upload throttling:** 30 uploads per user and 120 per organisation per hour, counting rejected files too (fails closed).
- **The PDF token check is advisory.** It flags active-content markers (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/OpenAction`, `/AA`,
  `/GoToR`, `/GoToE`, `/SubmitForm`, `/ImportData`, `/XFA`) outside stream bodies; markers inside compressed object streams are invisible to it.
  clamd is the control.

### Known residual risk: request body limits

`next.config.ts` raises `proxyClientMaxBodySize` and `serverActions.bodySizeLimit` to 16 MB so 10 MiB uploads work. Those limits apply to all routes that
go through the proxy. Mitigation in `src/proxy.ts`: a POST announcing more than 1 MB (by `Content-Length`) is refused with 413 unless it targets the two
upload pages (`/orgs/[id]/business/onboarding` and `/verification`). `/api` and `/auth` bypass the proxy and chunked bodies carry no length, so put edge
or WAF body limits in front of the app, or move uploads to a dedicated route in a later hardening pass.

### Data retention (not yet decided)

Claim snapshots (street addresses, representative names), reviewer decision reasons and verification events are kept indefinitely. Documents are removed
from storage only when an owner removes an unsubmitted one or an infected file is found. A retention period and an erasure path need an owner and a legal
decision before real data is accepted.
