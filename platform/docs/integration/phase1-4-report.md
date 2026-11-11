# Phases 1-4 integration report (2026-11-11)

Branch `integration/phase1-4` (local; Phase 3 head `9f3ef6e` + Codex Phase 4 `25e3435` + integration commit). Nothing is merged, pushed from this branch, or applied to hosted staging. All test evidence below is LOCAL on an isolated Supabase stack (not hosted, not the shared stack).

## What was integrated
- Phase 4 (`25e3435`) merged onto Phase 3. Five conflicts, all additive (messages, error keys, business page links, RPC allow-list). Phase 4 migrations renamed in this branch to `000103`/`000104` (content unchanged); Codex's own workspace was not touched.
- Bahasa Melayu text added for every new Phase 4 string (machine-assisted draft; no human review).
- **Referral hand-off** (Phase 3 owned): `public.open_referral_enquiry(p_referral)` + table `public.referral_handoffs`, migration `000105`; recipient-only button "Start the conversation" on the leads page; contract `p3p4-contract/1.2` section 11.

## Migration order
`000001-000011` (hosted already has these, under other version stamps), `000012-000014`, `000100-000102`, `000103-000104` (Phase 4), `000105` (hand-off). Exact hosted sequence: `phase1-4-staging-deployment.md`.

## Referral hand-off, end to end (verified locally)
Browser test E46 (phone and desktop width): request on the board, seller A replies (Phase 3 enquiry), A suggests seller B (UI), B sees nothing before consent, customer consents (UI), B accepts and starts the conversation (UI), one referral enquiry exists with the customer, B and the original request link, no copied note; a second click and a colleague's call create nothing new; B writes, customer reads; the customer's phone and email never appear on B's page; seller A and an outsider get 404 on the new enquiry. Database tests H1-H38 cover consent order, who may call it (buyer, referrer, outsider, viewer, anonymous), idempotency, closed/blocked/expired inputs, unavailable recipient, reuse of an existing enquiry, no direct writes, grants.

## Test results (local)
| Check | Result |
|---|---|
| Fresh database, migrations 1-105 in one pass | pass |
| pgTAP, 12 files | 1,062 assertions pass |
| Unit | 301 pass (clean environment; one test fails only if a Supabase URL is exported in the shell, same as before) |
| Integration | 117 pass |
| Typecheck, lint | pass; 0 lint errors (4 old warnings) |
| Production build | pass (before the last test-only edits) |
| Browser, 8 sequential shards, 360px and 1280px, axe | 286 tests; 283 passed first time. 3 failed because of Windows browser/app-server crashes (exit 3221226505; connection refused on the local app); those three specs (E46, E8, E28/E29, 36 tests) were rerun and pass |
| PR #6 (Phase 3 head `9f3ef6e`) GitHub CI | both `Platform` runs pass (26m, 29m); `Astro landing page still builds` passes; `Workers Builds: mitra-landing` fails (Cloudflare build of the landing site; also fails on PR #5, not Phase 3) |
| CI on this integration branch | not run (branch not pushed) |

## Reviews
- Independent review 1 of the hand-off: no critical, no high; 2 medium and 5 low. Fixed: no existence signal before consent (404, checked before permission and before locking), closed source enquiry blocks, audit with `reused`, blocked reused enquiry refused, unlocked authorisation before the row lock; deployment doc gained target-project checks, statements and dump comparisons before the push, grants check, forward-fix note.
- Re-review of the fixes: no critical, no high, no medium; 4 low items, all addressed (reuse/blocked tests, stale numbers, contract text, number clash).
- Accepted limits (contract section 11): buyer consent has no expiry or withdrawal in Phase 4; topic copied from the source enquiry; `opened_by` has no foreign key.
- Limit: reviewers are model-based; no human security review has happened.

## Finding for Phase 4 (Codex to fix; not changed here)
`referral_suggestions` foreign keys to organisations and users have no delete rule, so erasing an organisation or user in a referral fails (`23503`). Details and a suggested migration: `codex-coordination.md` section 5.

## Blockers for staging deployment
1. Owner approval for the history repair (steps 4-5) and for the push (step 7), and a named single operator.
2. Codex must rename its two migrations and merge the integration changes (see `codex-coordination.md`); until then the deployable set exists only on this branch.
3. No hosting project, staging env vars, auth redirect URLs or SMTP; no malware scanner. Hosted smoke tests cannot run until those exist (`staging-readiness.md`).
4. Phase 4 erasure fix (above) before any real user data.
5. Human review of Tamil and Bahasa Melayu text; legal pages are placeholders; anonymous directory search needs an edge rate limit.
6. The E43 title-tag flake fix (letters-only tags) is only on this branch; PR #6 still has the rare flake until it is applied there.
