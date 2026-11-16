# INOK launch checklist (2026-11-16; supersedes `production-readiness-checklist.md` where they differ)

Status words: **Done (hosted)** = verified on the real Cloudflare/Supabase service; **Done (local)** = local tests only; **Blocked: email** = needs the transactional mail provider; **Owner** = needs a decision or an action only you can take; **Open**.

## A. Can be completed now, without email and without spending
| Item | Status | Evidence / next step |
|---|---|---|
| Production database `inok-production`, 41 migrations, parity with local, advisors 0 errors | Done (hosted) | `infrastructure-status.md` |
| Staging database `mitra-staging`, same state | Done (hosted) | `staging-migration-reconciliation.md` |
| Workers deployed separately, each on its own Supabase project, own secrets, own access key | Done (hosted) | cross-key probes: each key opens only its own Worker; bundles reference only their own project |
| Staging and production gated (401 without key) | Done (hosted) | `cf-entry.mjs` |
| Public sign-up disabled on production | Done (hosted) | `signup_disabled` on a real request |
| Hosted browser tests (buyer, seller, quotations, government programmes, recovery, MFA admin, RLS) | Done (hosted) | `tests/hosted`, see report for the latest counts |
| Hosted supplier sourcing, document upload, cross-tenant tests | Done (hosted) | `tests/hosted/sourcing-uploads.spec.ts` |
| Advisor warnings reviewed one by one | Done | `advisor-review.md` |
| Backup of data, Auth data and private storage files plus restore test | Done for database and Auth (hosted data into a disposable DB); storage procedure scripted | `backup-and-recovery.md`, `deploy/backup/backup.sh` |
| Documents stay quarantined until scanned | Done (hosted) | `malware-scanning-options.md` |
| Domain and landing integration prepared | Prepared | `app-domain-and-landing-integration.md` |
| Weekly backup routine started on production once real data exists | Open | run `deploy/backup/backup.sh` then `restore-test.sh` |
| First administrator created on production (`bootstrap_first_admin`), MFA, second administrator | Owner | do on launch week, never with a shared account |
| Privacy policy and terms published and linked at sign-up (consent versions must match) | Owner | |
| Malay and Tamil wording reviewed by native speakers | Owner | drafts in app and in email templates |
| Government programme records verified by a person before publishing | Owner | publishing switch is off by default |
| Uptime check on `/api/v1/health`, alert on scheduler failures | Open | free options: Cloudflare Health Checks need a paid plan; use a free external monitor or the Workers observability logs |
| Production scheduler Worker (`inok-scheduler-production`) | Open | create only when production has real data; same files as staging with the production service binding |
| Cloudflare Access in front of staging | Optional | the access key already protects it |

## B. Blocked by transactional email (you configure later)
| Item | Why blocked |
|---|---|
| Sign-up confirmation, password recovery, invitations, email change on real addresses | the default Supabase mail only reaches team members and is rate-limited; templates cannot be changed on the Free plan with default SMTP |
| Pushing the 8 prepared templates (`supabase/templates`, `deploy/supabase-auth/templates-to-push.toml`) | needs custom SMTP (expected to be allowed once custom SMTP is set; not verified) |
| SPF, DKIM, DMARC for `inok.my` | DNS changes you approve |
| Enabling public sign-up | must wait for confirmation mail that actually arrives |
| Application emails (verification decisions, quotation and enquiry notices, programme reminders, digest) | set `SMTP_URL` as a Worker secret |
| Verification of email delivery | not done, **unverified** |

Steps when ready are in `email-activation-plan.md`.

## C. Blocked by something else
| Item | Blocker | Free path |
|---|---|---|
| Malware scanner | no always-on free host exists inside Cloudflare/Supabase | `malware-scanning-options.md`: a spare machine through a Cloudflare Tunnel, or a free cloud VM you create; until then every upload stays quarantined and cannot be approved or downloaded, so **document verification cannot complete** |
| Production backups | Free plan has none automatic | manual script, schedule from your machine |
| Production pauses when idle | Free plan | accepted risk; weekly traffic or a keep-alive check avoids it; launch with real customers is the point to reconsider (not purchased) |
| Production region is Tokyo | chosen at creation | recreate while empty if latency matters |
| Windows test runner crash 3221226505 | unexplained, intermittent | does not affect hosted behaviour |
| `mitra-landing` Workers Builds red on non-production branches | need build-log access | does not affect production |

## D. Launch-day gates (every one signed by a named person)
- [ ] Staging acceptance repeated on the exact commit being released
- [ ] SMTP delivery verified with real mailboxes; SPF, DKIM, DMARC pass; templates pushed
- [ ] Scanner connected; EICAR rejected; a clean PDF released
- [ ] First and second administrator exist with MFA
- [ ] Production backup taken and restored once with real data
- [ ] Privacy policy and terms live; language review done; programme data reviewed
- [ ] `app.inok.my` attached (still gated), checks pass; then gate removed
- [ ] Landing page pull request approved and merged last
- [ ] Management approval to enable public sign-up
